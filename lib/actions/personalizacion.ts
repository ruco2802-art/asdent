"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/database.types";

const DEFAULT_PROMPT =
  "Eres el asistente virtual de la clínica dental. Tu función es agendar citas de forma eficiente y con empatía.\n\nResponde siempre en español. Si el paciente menciona dolor, urgencia o emergencia dental, responde con empatía inmediata y ofrece el slot más próximo disponible.\n\nConfirma siempre todos los datos con el paciente antes de registrar la cita.";

export async function saveAgentConfigAction(
  formData: FormData
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado" };

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
  const orgId = (rawProfile as { organization_id: string | null } | null)
    ?.organization_id;
  if (!orgId) return { error: "Sin organización" };

  const system_prompt =
    (formData.get("system_prompt") as string)?.trim() || DEFAULT_PROMPT;
  const tone = (formData.get("tone") as string) || "profesional y cálido";
  const assistant_name =
    (formData.get("assistant_name") as string)?.trim() || "Valentina";
  const handoff_message =
    (formData.get("handoff_message") as string)?.trim() || null;
  const confirmation_template =
    (formData.get("confirmation_template") as string)?.trim() || null;
  const notification_phone =
    (formData.get("notification_phone") as string)?.trim() || null;

  // DECISION: JSON.parse retorna unknown; cast a Json para compatibilidad con tipos Supabase
  let business_info: Json = {};
  let services: Json = [];
  let business_hours: Json = {};

  try {
    const v = JSON.parse((formData.get("business_info") as string) ?? "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) business_info = v as Json;
  } catch { /* keep empty */ }

  try {
    const v = JSON.parse((formData.get("services") as string) ?? "[]");
    if (Array.isArray(v)) services = v as Json;
  } catch { /* keep empty */ }

  try {
    const v = JSON.parse((formData.get("business_hours") as string) ?? "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) business_hours = v as Json;
  } catch { /* keep empty */ }

  const service = createServiceClient();
  const { error } = await service.from("agent_configs").upsert(
    {
      organization_id: orgId,
      system_prompt,
      tone,
      assistant_name,
      business_info,
      services,
      business_hours,
      handoff_message,
      confirmation_template,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );

  if (error) return { error: "Error al guardar la configuración" };

  const { error: orgError } = await service
    .from("organizations")
    .update({ notification_phone })
    .eq("id", orgId);

  if (orgError) return { error: "Error al guardar el teléfono de notificaciones" };

  return {};
}
