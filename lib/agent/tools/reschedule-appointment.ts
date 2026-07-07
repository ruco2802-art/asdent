import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getGoogleCalendarContext,
  createCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";
import type { AgentConfig, Organization } from "@/lib/database.types";
import { type ServiceConfig, getServiceDuration } from "./_utils";
import { findUpcomingAppointment } from "./_appointment-lookup";

interface RescheduleContext {
  organizationId: string;
  contactId: string;
  waPhone: string;
}

export function createRescheduleAppointmentTool(ctx: RescheduleContext) {
  const { organizationId, contactId, waPhone } = ctx;

  return tool({
    description:
      "Reprograma una cita próxima del paciente a un horario nuevo, en un solo paso: cancela la cita actual y agenda la nueva, actualizando Google Calendar. Busca automáticamente la cita del paciente — no necesitas un ID. El nuevo horario debe ser un slot real devuelto por get_available_slots. Si el paciente tiene más de una cita próxima, la tool devuelve la lista para que le preguntes cuál y vuelvas a llamarla con starts_at.",
    inputSchema: z.object({
      new_starts_at: z
        .string()
        .describe(
          "Nueva fecha y hora de inicio en ISO 8601 (debe venir de get_available_slots, no inventada)."
        ),
      starts_at: z
        .string()
        .optional()
        .describe(
          "Solo si el paciente tiene más de una cita próxima: la fecha/hora ISO exacta de la cita ACTUAL que quiere mover."
        ),
    }),
    execute: async ({ new_starts_at, starts_at }) => {
      const newStartsAt = new Date(new_starts_at);
      if (isNaN(newStartsAt.getTime())) {
        return { error: `Formato de fecha inválido: ${new_starts_at}` };
      }

      const lookup = await findUpcomingAppointment(organizationId, contactId, starts_at);

      if (lookup.kind === "none") {
        return { error: "No encontré ninguna cita próxima a tu nombre para reprogramar." };
      }

      if (lookup.kind === "ambiguous") {
        return {
          multiple_appointments: lookup.appointments.map((a) => ({
            starts_at: a.starts_at,
            service: a.service,
          })),
          message:
            "El paciente tiene más de una cita próxima — pregúntale cuál quiere reprogramar y vuelve a llamar esta tool con starts_at.",
        };
      }

      const oldAppt = lookup.appointment;
      const db = createServiceClient();

      const [{ data: rawConfig }, { data: rawOrg }] = await Promise.all([
        db.from("agent_configs").select("*").eq("organization_id", organizationId).maybeSingle(),
        db.from("organizations").select("*").eq("id", organizationId).maybeSingle(),
      ]);
      // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .maybeSingle() con tipos manuales
      const config = rawConfig as AgentConfig | null;
      const org = rawOrg as Organization | null;
      const timezone = org?.timezone ?? "America/Bogota";
      const services = (config?.services ?? []) as unknown as ServiceConfig[];
      const durationMin = getServiceDuration(oldAppt.service, services);
      const newEndsAt = new Date(newStartsAt.getTime() + durationMin * 60 * 1000);

      // 1. Cancelar la cita anterior (DB + Google Calendar)
      const { error: cancelError } = await db
        .from("appointments")
        .update({ status: "cancelled", confirmation_status: "rescheduled" })
        .eq("id", oldAppt.id);

      if (cancelError) {
        return { error: `Error al liberar la cita anterior: ${cancelError.message}` };
      }

      const gcal = await getGoogleCalendarContext(organizationId).catch(() => null);

      if (oldAppt.google_event_id && gcal) {
        try {
          await deleteCalendarEvent(gcal.accessToken, gcal.calendarId, oldAppt.google_event_id);
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "reschedule_gcal_delete_error",
              organization_id: organizationId,
              appointment_id: oldAppt.id,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      }

      // 2. Agendar la nueva cita, reusando los datos del paciente que ya
      // teníamos (no hace falta pedírselos de nuevo).
      const { data: newAppt, error: insertError } = await db
        .from("appointments")
        .insert({
          organization_id: organizationId,
          contact_id: contactId,
          service: oldAppt.service,
          starts_at: newStartsAt.toISOString(),
          ends_at: newEndsAt.toISOString(),
          status: "confirmed",
          is_new_patient: oldAppt.is_new_patient,
          is_urgent: oldAppt.is_urgent,
          full_name: oldAppt.full_name,
          phone: waPhone,
          medical_notes: oldAppt.medical_notes,
          notes: oldAppt.notes,
        })
        .select("id")
        .single();

      if (insertError || !newAppt) {
        return {
          error: `La cita anterior se canceló pero hubo un error al crear la nueva: ${insertError?.message ?? "error desconocido"}. Pide que te transfieran con el equipo para agendar manualmente.`,
        };
      }

      // DECISION: cast necesario — supabase-js@2.49.9 infiere never
      const { id: newAppointmentId } = newAppt as { id: string };

      if (gcal) {
        try {
          const googleEventId = await createCalendarEvent(gcal.accessToken, gcal.calendarId, {
            summary: `${oldAppt.service} — ${oldAppt.full_name}`,
            description: [
              `Servicio: ${oldAppt.service}`,
              `Paciente: ${oldAppt.full_name}`,
              `Teléfono: ${waPhone}`,
              ...(oldAppt.notes ? [`Motivo: ${oldAppt.notes}`] : []),
              ...(oldAppt.medical_notes ? [`Notas médicas: ${oldAppt.medical_notes}`] : []),
            ].join("\n"),
            startsAt: newStartsAt.toISOString(),
            endsAt: newEndsAt.toISOString(),
            timezone,
            isUrgent: oldAppt.is_urgent ?? false,
          });

          await db
            .from("appointments")
            .update({ google_event_id: googleEventId })
            .eq("id", newAppointmentId);
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "reschedule_gcal_create_error",
              organization_id: organizationId,
              appointment_id: newAppointmentId,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      }

      return {
        ok: true,
        rescheduled_from: oldAppt.starts_at,
        rescheduled_to: newStartsAt.toISOString(),
        service: oldAppt.service,
        message: "Cita reprogramada correctamente. Avísale al paciente la nueva fecha y hora.",
      };
    },
  });
}
