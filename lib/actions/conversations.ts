"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export async function toggleBotAction(
  formData: FormData
): Promise<{ error?: string }> {
  const conversationId = formData.get("conversationId") as string | null;
  const botActiveStr = formData.get("botActive") as string | null;

  if (!conversationId || botActiveStr === null) {
    return { error: "Parámetros inválidos" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado" };

  // Get organization_id for ownership verification
  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
  const organizationId = (
    rawProfile as { organization_id: string | null } | null
  )?.organization_id;
  if (!organizationId) return { error: "Sin organización" };

  const botActive = botActiveStr === "true";
  // DECISION: usar service client para .update() — createServerClient<Database> de @supabase/ssr
  // infiere never para el argumento de .update(), problema conocido de tipos en esa versión
  const service = createServiceClient();
  const { error } = await service
    .from("conversations")
    .update({ bot_active: botActive })
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  if (error) return { error: "Error al actualizar el bot" };
  return {};
}

export async function sendHumanMessageAction(
  formData: FormData
): Promise<{ error?: string }> {
  const conversationId = formData.get("conversationId") as string | null;
  const organizationId = formData.get("organizationId") as string | null;
  const waPhone = formData.get("waPhone") as string | null;
  const content = (formData.get("content") as string | null)?.trim() ?? "";

  if (!conversationId || !organizationId || !waPhone || !content) {
    return { error: "Parámetros inválidos" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado" };

  let wamid: string;
  try {
    wamid = await sendWhatsAppMessage(organizationId, waPhone, content);
  } catch {
    return { error: "No se pudo enviar el mensaje por WhatsApp" };
  }

  const service = createServiceClient();
  await service.from("messages").insert({
    conversation_id: conversationId,
    organization_id: organizationId,
    wa_message_id: wamid,
    direction: "outbound",
    sender: "human",
    content,
    created_at: new Date().toISOString(),
  });

  return {};
}
