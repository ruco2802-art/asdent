import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { getGoogleCalendarContext, deleteCalendarEvent } from "@/lib/google-calendar";
import { findUpcomingAppointment } from "./_appointment-lookup";

interface CancelContext {
  organizationId: string;
  contactId: string;
}

export function createCancelAppointmentTool(ctx: CancelContext) {
  const { organizationId, contactId } = ctx;

  return tool({
    description:
      "Cancela una cita próxima del paciente y libera el evento en Google Calendar. Busca automáticamente la cita del paciente — no necesitas un ID. Si el paciente tiene más de una cita próxima, la tool devuelve la lista para que le preguntes cuál y vuelvas a llamarla con starts_at.",
    inputSchema: z.object({
      starts_at: z
        .string()
        .optional()
        .describe(
          "Solo si el paciente tiene más de una cita próxima: la fecha/hora ISO exacta (tal como te la devolvió esta misma tool) de la cita que quiere cancelar."
        ),
    }),
    execute: async ({ starts_at }) => {
      const lookup = await findUpcomingAppointment(
        organizationId,
        contactId,
        starts_at
      );

      if (lookup.kind === "none") {
        return { error: "No encontré ninguna cita próxima a tu nombre para cancelar." };
      }

      if (lookup.kind === "ambiguous") {
        return {
          multiple_appointments: lookup.appointments.map((a) => ({
            starts_at: a.starts_at,
            service: a.service,
          })),
          message:
            "El paciente tiene más de una cita próxima — pregúntale cuál quiere cancelar y vuelve a llamar esta tool con starts_at.",
        };
      }

      const appt = lookup.appointment;
      const db = createServiceClient();

      const { error: updateError } = await db
        .from("appointments")
        .update({ status: "cancelled", confirmation_status: "cancelled" })
        .eq("id", appt.id);

      if (updateError) {
        return { error: `Error al cancelar la cita: ${updateError.message}` };
      }

      if (appt.google_event_id) {
        const gcal = await getGoogleCalendarContext(organizationId).catch(() => null);
        if (gcal) {
          try {
            await deleteCalendarEvent(gcal.accessToken, gcal.calendarId, appt.google_event_id);
          } catch (err) {
            console.error(
              JSON.stringify({
                event: "cancel_gcal_delete_error",
                organization_id: organizationId,
                appointment_id: appt.id,
                error: err instanceof Error ? err.message : String(err),
              })
            );
          }
        }
      }

      return {
        ok: true,
        cancelled: { service: appt.service, starts_at: appt.starts_at },
        message: "Cita cancelada correctamente. Avísale al paciente que quedó cancelada.",
      };
    },
  });
}
