import { createServiceClient } from "@/lib/supabase/service";
import { decrypt } from "@/lib/crypto";
import type { WhatsappConfig, Json } from "@/lib/database.types";
import { GRAPH_API_VERSION } from "./send";

const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface GraphSendResponse {
  messages: { id: string }[];
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; type?: string };
}

// Meta requires a pre-approved template to message a patient outside the
// 24h free-form window — this is exactly the confirmation reminder case,
// since the patient may not have written in over a day. Until the template
// is approved, WHATSAPP_CONFIRMATION_TEMPLATE_NAME is unset and callers get
// a clear "not configured" error instead of a confusing Graph API failure.
export function getConfirmationTemplateName(): string | null {
  return process.env.WHATSAPP_CONFIRMATION_TEMPLATE_NAME || null;
}

// Configurable porque el código de idioma exacto que Meta ofrece al crear la
// plantilla puede no ser "es_CO" (a veces solo hay "es" genérico, o "es_LA")
// — así no hace falta un cambio de código si no coincide.
export function getConfirmationTemplateLanguage(): string {
  return process.env.WHATSAPP_CONFIRMATION_TEMPLATE_LANG || "es_CO";
}

/**
 * Envía un mensaje de plantilla (template) pre-aprobado por Meta.
 *
 * @param bodyParams  - Valores para las variables {{1}}, {{2}}, etc. del
 *                      body de la plantilla, en orden.
 */
export async function sendWhatsAppTemplate(
  organizationId: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[]
): Promise<string> {
  const service = createServiceClient();
  const { data: raw } = await service
    .from("whatsapp_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!raw) {
    throw new Error(`No WhatsApp config found for organization ${organizationId}`);
  }

  const config = raw as WhatsappConfig;
  const accessToken = decrypt(config.access_token_encrypted);
  const recipient = to.startsWith("+") ? to.slice(1) : to;

  const res = await fetch(`${GRAPH_API_BASE}/${config.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    } satisfies Record<string, Json>),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as GraphErrorBody;
    throw new Error(`Graph API ${res.status}: ${errBody.error?.message ?? "Unknown error"}`);
  }

  const body = (await res.json()) as GraphSendResponse;
  const wamid = body.messages?.[0]?.id;
  if (!wamid) throw new Error("Graph API response missing message ID (wamid)");
  return wamid;
}
