import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import type { Organization } from "@/lib/database.types";

export type AlertType = "handoff_needed" | "appointment_at_risk";

interface CreateAlertInput {
  organizationId: string;
  type: AlertType;
  message: string;
  conversationId?: string;
  appointmentId?: string;
}

const ALERT_PREFIX: Record<AlertType, string> = {
  handoff_needed: "🔔 Un paciente necesita atención humana",
  appointment_at_risk: "⚠️ Cita en riesgo de no confirmarse",
};

// Single entry point for anything that needs human attention — handoff
// requests today, at-risk appointment confirmations tomorrow, whatever
// comes next without a new table or a new notification path.
export async function createAlert(input: CreateAlertInput): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("alerts").insert({
    organization_id: input.organizationId,
    type: input.type,
    conversation_id: input.conversationId ?? null,
    appointment_id: input.appointmentId ?? null,
    message: input.message,
  });

  if (error) {
    console.error(
      JSON.stringify({
        event: "alert_insert_error",
        type: input.type,
        organization_id: input.organizationId,
        error: error.message,
      })
    );
    return;
  }

  const { data: rawOrg } = await db
    .from("organizations")
    .select("notification_phone")
    .eq("id", input.organizationId)
    .maybeSingle();
  const notificationPhone = (rawOrg as Pick<Organization, "notification_phone"> | null)
    ?.notification_phone;

  if (!notificationPhone) {
    console.warn(
      JSON.stringify({
        event: "admin_notification_phone_not_configured",
        organization_id: input.organizationId,
      })
    );
    return;
  }

  // Best-effort: si el admin no le ha escrito al número de la clínica en
  // las últimas 24h, Meta puede rechazar este mensaje libre igual que
  // cualquier mensaje a un paciente inactivo (regla de la ventana de 24h de
  // WhatsApp — no es específico de este código). No bloquea nada si falla:
  // la alerta ya quedó creada y visible en el dashboard de todas formas.
  try {
    await sendWhatsAppMessage(
      input.organizationId,
      notificationPhone,
      `${ALERT_PREFIX[input.type]}\n\n${input.message}`
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "admin_notify_error",
        organization_id: input.organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}
