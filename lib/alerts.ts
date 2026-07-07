import { createServiceClient } from "@/lib/supabase/service";

export type AlertType = "handoff_needed" | "appointment_at_risk";

interface CreateAlertInput {
  organizationId: string;
  type: AlertType;
  message: string;
  conversationId?: string;
  appointmentId?: string;
}

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

  // TODO(punto 6): notificar al admin por WhatsApp — pendiente de un número
  // de destino del dueño de la clínica, que hoy no existe en el schema.
}
