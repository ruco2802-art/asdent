import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getGoogleCalendarContext,
  createCalendarEvent,
} from "@/lib/google-calendar";
import type { AgentConfig, Organization, Json } from "@/lib/database.types";
import {
  type ServiceConfig,
  type BusinessHours,
  getServiceDuration,
  getWeekdayInTz,
} from "./_utils";

interface BookContext {
  organizationId: string;
  contactId: string;
  conversationId: string;
  waPhone: string;
}

function localMinutesOfDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

// Defensa server-side independiente del LLM: si el modelo reconstruye una
// hora de memoria en vez de reutilizar el "iso" exacto de get_available_slots
// (ej. tras una llamada redundante a book_appointment), puede calcular mal el
// offset de zona horaria y terminar con una hora fuera de servicio (visto en
// producción: 8:00 a.m. local mal escrito como 08:00 UTC = 3:00 a.m. local).
// Esta validación bloquea eso sin importar cómo se produjo el error.
function isWithinBusinessHours(
  startsAt: Date,
  endsAt: Date,
  businessHours: BusinessHours,
  timezone: string
): boolean {
  const weekday = getWeekdayInTz(startsAt, timezone);
  const periods = businessHours[weekday] ?? [];
  const startMinutes = localMinutesOfDay(startsAt, timezone);
  const endMinutes =
    startMinutes + (endsAt.getTime() - startsAt.getTime()) / 60000;

  return periods.some((p) => {
    const [sh, sm] = p.start.split(":").map(Number);
    const [eh, em] = p.end.split(":").map(Number);
    const periodStart = sh * 60 + (sm ?? 0);
    const periodEnd = eh * 60 + (em ?? 0);
    return startMinutes >= periodStart && endMinutes <= periodEnd;
  });
}

export function createBookAppointmentTool(ctx: BookContext) {
  const { organizationId, contactId, conversationId, waPhone } = ctx;

  return tool({
    description:
      "Crea una cita, la registra en el sistema y crea el evento en Google Calendar. Llamar solo después de que el paciente haya confirmado explícitamente el nombre, servicio, fecha y hora. Incluye siempre 'reason' con un resumen del motivo de consulta — el odontólogo lo ve en el dashboard antes de la cita.",
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
      reason: z
        .string()
        .describe(
          "Resumen breve (1-2 frases) del motivo de la consulta, en base a lo que contó el paciente durante la conversación — para que el odontólogo pueda prepararse con anticipación antes de la cita. Ej: 'Dolor en muela inferior derecha desde hace 3 días' o 'Valoración de ventana quirúrgica para niña de 8 años, primera consulta'. Sé específico con los síntomas o la solicitud puntual del paciente, no repitas solo el nombre del servicio."
        ),
    }),
    execute: async ({
      full_name,
      service,
      starts_at,
      is_new_patient,
      is_urgent = false,
      medical_notes,
      reason,
    }) => {
      try {
        return await bookAppointment();
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "book_appointment_fatal_error",
            organization_id: organizationId,
            conversation_id: conversationId,
            starts_at,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          })
        );
        return {
          error:
            "Hubo un problema técnico al registrar la cita. Por favor intenta de nuevo o pide que te transfiramos con el equipo.",
        };
      }

      async function bookAppointment() {
      const startsAt = new Date(starts_at);
      if (isNaN(startsAt.getTime())) {
        return { error: `Formato de fecha inválido: ${starts_at}` };
      }
      // Mismo buffer de 30 min que get_available_slots — evita agendar una
      // hora que ya pasó o está por pasar (ej. un slot ofrecido horas antes
      // en la misma conversación, ya inválido cuando el paciente confirma).
      if (startsAt.getTime() < Date.now() + 30 * 60 * 1000) {
        return {
          error:
            "Esa hora ya pasó o está a menos de 30 minutos — no se puede agendar. Vuelve a llamar a get_available_slots para ofrecer un horario válido antes de confirmar de nuevo con el paciente.",
        };
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

      // DECISION: double cast (unknown) necesario — Json no es directamente asignable a BusinessHours
      const businessHours = (config?.business_hours ?? {}) as unknown as BusinessHours;
      if (
        Object.keys(businessHours).length > 0 &&
        !isWithinBusinessHours(startsAt, endsAt, businessHours, timezone)
      ) {
        return {
          error:
            "Esa hora está fuera del horario de atención de la clínica — no se puede agendar. Vuelve a llamar a get_available_slots para ofrecer un horario real dentro de horario antes de confirmar de nuevo con el paciente.",
        };
      }

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
          notes: reason,
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
            `Motivo: ${reason}`,
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
              organization_id: organizationId,
              conversation_id: conversationId,
              appointment_id: appointmentId,
              calendar_id: gcal.calendarId,
              starts_at: startsAtISO,
              ends_at: endsAt.toISOString(),
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
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
      }
    },
  });
}
