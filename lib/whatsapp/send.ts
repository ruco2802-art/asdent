import { createServiceClient } from "@/lib/supabase/service";
import { decrypt } from "@/lib/crypto";
import type { WhatsappConfig, Json } from "@/lib/database.types";

export const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface GraphSendResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; type?: string };
}

/**
 * Envía un mensaje de texto vía WhatsApp Cloud API.
 *
 * @param organizationId  - UUID de la organización (para leer su config de DB)
 * @param to              - Teléfono del destinatario en E.164, ej. "+573001234567"
 * @param text            - Texto del mensaje (máx. 4096 chars según Meta)
 * @returns wamid         - ID del mensaje asignado por Meta (para persistir en DB)
 * @throws                - Si la config no existe, el token falla, o la API devuelve error
 */
export async function sendWhatsAppMessage(
  organizationId: string,
  to: string,
  text: string
): Promise<string> {
  const service = createServiceClient();
  const { data: raw } = await service
    .from("whatsapp_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!raw) {
    throw new Error(
      `No WhatsApp config found for organization ${organizationId}`
    );
  }

  const config = raw as WhatsappConfig;
  const accessToken = decrypt(config.access_token_encrypted);

  // Meta acepta el número sin '+'; normalizamos para ser consistentes
  const recipient = to.startsWith("+") ? to.slice(1) : to;

  const res = await fetch(
    `${GRAPH_API_BASE}/${config.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { body: text },
      } satisfies Record<string, Json>),
    }
  );

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as GraphErrorBody;
    throw new Error(
      `Graph API ${res.status}: ${errBody.error?.message ?? "Unknown error"}`
    );
  }

  const body = (await res.json()) as GraphSendResponse;
  const wamid = body.messages?.[0]?.id;

  if (!wamid) {
    throw new Error("Graph API response missing message ID (wamid)");
  }

  return wamid;
}
