"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { runAgent } from "@/lib/agent/run";
import type { Json } from "@/lib/database.types";

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

  // Al reactivar, si el último mensaje es del paciente (nadie — ni el bot ni
  // un humano — respondió mientras estuvo desactivado), procesarlo de una
  // vez. Sin esto, el agente se queda en silencio indefinidamente esperando
  // un mensaje NUEVO del paciente, dejando sin respuesta lo que ya escribió
  // durante la intervención humana.
  if (botActive) {
    after(() => resumePendingConversation(conversationId, organizationId, service));
  }

  return {};
}

async function resumePendingConversation(
  conversationId: string,
  organizationId: string,
  service: ReturnType<typeof createServiceClient>
): Promise<void> {
  const { data: rawLastMsg } = await service
    .from("messages")
    .select("direction")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastMsg = rawLastMsg as { direction: string } | null;
  if (lastMsg?.direction !== "inbound") return; // ya fue respondido

  const { data: rawConv } = await service
    .from("conversations")
    .select("contact_id, booking_state, booking_data, contacts(wa_phone)")
    .eq("id", conversationId)
    .maybeSingle();
  const conv = rawConv as {
    contact_id: string;
    booking_state: string | null;
    booking_data: Json | null;
    contacts: { wa_phone: string } | null;
  } | null;
  if (!conv?.contacts?.wa_phone) return;

  await runAgent({
    organizationId,
    contactId: conv.contact_id,
    conversationId,
    waPhone: conv.contacts.wa_phone,
    bookingState: conv.booking_state,
    bookingData: conv.booking_data,
  });
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
