import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getGoogleCalendarContext,
  createCalendarEvent,
} from "@/lib/google-calendar";
import type { AgentConfig, Organization, Json } from "@/lib/database.types";
import { type ServiceConfig, getServiceDuration } from "./_utils";

interface BookContext {
  organizationId: string;
  contactId: string;
  conversationId: string;
  waPhone: string;
}

export function createBookAppointmentTool(ctx: BookContext) {
  const { organizationId, contactId, conversationId, waPhone } = ctx;

  return tool({
    description:
      "Crea una cita, la registra en el sistema y crea el evento en Google Calendar. Llamar solo después de que el paciente haya confirmado explícitamente el nombre, servicio, fecha y hora.",
    inputSchema: z.object({
      full_name: z.string().describe("Nombre completo del paciente"),
      service: z.string().describe("Nombre del servicio dental"),
      starts_at: z
        .string()
        .describe(
          "Fecha y hora de inicio en ISO 8601 (e.g. 2026-06-23T13:00:00.000Z)"
        ),
      is_new_patient: z.boolean().describe("Si es paciente nuevo"),
      is_urgent: z
        .boolean()
        .optional()
        .describe("Si la cita es de urgencia"),
      medical_notes: z
        .string()
        .optional()
        .describe("Notas médicas relevantes (alergias, anticoagulantes, etc.)"),
    }),
    execute: async ({
      full_name,
      service,
      starts_at,
      is_new_patient,
      is_urgent = false,
      medical_notes,
    }) => {
      const startsAt = new Date(starts_at);
      if (isNaN(startsAt.getTime())) {
        return { error: `Formato de fecha inválido: ${starts_at}` };
      }
      const startsAtISO = startsAt.toISOString();

      const db = createServiceClient();

      // Fetch agent config (service durations) and org timezone in parallel
      const [{ data: rawConfig }, { data: rawOrg }] = await Promise.all([
        db.from("agent_configs").select("*").eq("organization_id", organizationId).maybeSingle(),
        db.from("organizations").select("*").eq("id", organizationId).maybeSingle(),
      ]);
      // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .maybeSingle() con tipos manuales
      const config = rawConfig as AgentConfig | null;
      const org = rawOrg as Organization | null;
      const timezone = org?.timezone ?? "America/Bogota";
      // DECISION: double cast (unknown) necesario — Json no es directamente asignable a ServiceConfig[]
      const services = (config?.services ?? []) as unknown as ServiceConfig[];
      const durationMin = getServiceDuration(service, services);

      const endsAt = new Date(startsAt.getTime() + durationMin * 60 * 1000);

      // Idempotency: same contact + same start time
      const { data: existing } = await db
        .from("appointments")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .eq("starts_at", startsAtISO)
        .maybeSingle();

      if (existing) {
        // DECISION: cast necesario — supabase-js@2.49.9 infiere never
        const ex = existing as { id: string };
        await db
          .from("conversations")
          .update({ booking_state: "done", booking_data: {} as Json })
          .eq("id", conversationId);
        return {
          appointment_id: ex.id,
          message: "La cita ya estaba registrada.",
        };
      }

      const { data: appt, error: apptError } = await db
        .from("appointments")
        .insert({
          organization_id: organizationId,
          contact_id: contactId,
          service,
          starts_at: startsAtISO,
          ends_at: endsAt.toISOString(),
          status: "confirmed",
          is_new_patient,
          is_urgent,
          full_name,
          phone: waPhone,
          medical_notes: medical_notes ?? null,
          // google_event_id: null — TODO Paso 10
        })
        .select("id")
        .single();

      if (apptError || !appt) {
        return {
          error: `Error al crear la cita: ${apptError?.message ?? "Error desconocido"}`,
        };
      }

      // DECISION: cast necesario — supabase-js@2.49.9 infiere never
      const { id: appointmentId } = appt as { id: string };

      // Mark conversation booking as done
      await db
        .from("conversations")
        .update({ booking_state: "done", booking_data: {} as Json })
        .eq("id", conversationId);

      // Create Google Calendar event (best-effort — doesn't block the booking)
      const gcal = await getGoogleCalendarContext(organizationId).catch(() => null);
      if (gcal) {
        try {
          const eventDesc = [
            `Servicio: ${service}`,
            `Paciente: ${full_name}`,
            `Teléfono: ${waPhone}`,
            ...(medical_notes ? [`Notas médicas: ${medical_notes}`] : []),
            is_urgent ? "⚠️ URGENCIA" : "",
            is_new_patient ? "🆕 Paciente nuevo" : "",
          ]
            .filter(Boolean)
            .join("\n");

          const googleEventId = await createCalendarEvent(
            gcal.accessToken,
            gcal.calendarId,
            {
              summary: `${service} — ${full_name}`,
              description: eventDesc,
              startsAt: startsAtISO,
              endsAt: endsAt.toISOString(),
              timezone,
              isUrgent: is_urgent,
            }
          );

          await db
            .from("appointments")
            .update({ google_event_id: googleEventId })
            .eq("id", appointmentId);
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "google_event_error",
              appointment_id: appointmentId,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      }

      return {
        appointment_id: appointmentId,
        starts_at: startsAtISO,
        ends_at: endsAt.toISOString(),
        service,
        full_name,
        duration_minutes: durationMin,
        message: "Cita registrada correctamente.",
      };
    },
  });
}
