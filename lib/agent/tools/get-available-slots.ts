import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { getGoogleCalendarContext, getFreeBusy, type BusyPeriod } from "@/lib/google-calendar";
import type { AgentConfig, Organization } from "@/lib/database.types";
import {
  type BusinessHours,
  type ServiceConfig,
  getServiceDuration,
  getWeekdayInTz,
  getDatePartsInTz,
  localToUTC,
  isSlotBusy,
} from "./_utils";

type TimeOfDay = "mañana" | "tarde";
const NOON_MIN = 12 * 60;

// Días distintos y slots por día que se juntan en modo "overview" (pregunta
// abierta sobre disponibilidad, sin un día puntual en mente).
const OVERVIEW_DAYS = 3;
const OVERVIEW_SLOTS_PER_DAY = 2;

function generateSlots(
  businessHours: BusinessHours,
  durationMin: number,
  daysAhead: number,
  timezone: string,
  isUrgent: boolean,
  now: Date,
  timeOfDay?: TimeOfDay,
  overview?: boolean
): string[] {
  // Urgent = look 2 days (~48h) at most to find the single soonest slot
  const maxDays = isUrgent ? 2 : daysAhead;
  const urgentCutoff = now.getTime() + 24 * 60 * 60 * 1000;
  // 30-min buffer so we never offer a slot that starts in the next 30 minutes
  const earliest = now.getTime() + 30 * 60 * 1000;

  const overviewSlots: string[] = [];
  let daysWithSlots = 0;

  for (let d = 0; d < maxDays; d++) {
    const dayStart = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    const weekday = getWeekdayInTz(dayStart, timezone);
    const periods = businessHours[weekday] ?? [];
    const { year, month, day } = getDatePartsInTz(dayStart, timezone);
    const daySlots: string[] = [];

    for (const period of periods) {
      const [sh, sm] = period.start.split(":").map(Number);
      const [eh, em] = period.end.split(":").map(Number);
      let cur = sh * 60 + (sm ?? 0);
      let end = eh * 60 + (em ?? 0);
      // Clamp the period to the requested half of the day.
      if (timeOfDay === "mañana") end = Math.min(end, NOON_MIN);
      if (timeOfDay === "tarde") cur = Math.max(cur, NOON_MIN);

      while (cur + durationMin <= end) {
        const slotUTC = localToUTC(
          year,
          month,
          day,
          Math.floor(cur / 60),
          cur % 60,
          timezone
        );
        const t = slotUTC.getTime();
        if (t >= earliest && (!isUrgent || t <= urgentCutoff)) {
          daySlots.push(slotUTC.toISOString());
          // Urgent wants only the single soonest slot, not the whole day.
          if (isUrgent) break;
        }
        cur += 30; // 30-min grid
      }
      if (isUrgent && daySlots.length > 0) break;
    }

    if (daySlots.length === 0) continue;

    if (!overview) {
      // Modo normal: TODOS los slots del primer día con disponibilidad — no
      // un cap arbitrario (ver commit anterior: eso rompía la verificación
      // de horas puntuales). Si este día no tiene nada, sigue buscando.
      return daySlots;
    }

    // Modo overview: un par de horarios de este día, y seguir a otros días
    // hasta juntar OVERVIEW_DAYS días distintos — para responder "¿qué días
    // tienes?" con un panorama real en vez de un solo día a la vez.
    overviewSlots.push(...daySlots.slice(0, OVERVIEW_SLOTS_PER_DAY));
    daysWithSlots++;
    if (daysWithSlots >= OVERVIEW_DAYS) return overviewSlots;
  }

  return overviewSlots;
}

export function createGetAvailableSlotsTool(organizationId: string) {
  return tool({
    description:
      "Devuelve slots de tiempo disponibles, filtrando con Google Calendar FreeBusy si está configurado. Por defecto devuelve TODOS los horarios del primer día con disponibilidad dentro de la ventana solicitada. Si is_urgent=true devuelve solo el slot más próximo en 24h. Si overview=true devuelve un par de horarios de cada uno de 2-3 días distintos, para responder preguntas abiertas tipo '¿qué días tienes?'. Cada slot incluye un 'label' en español ya formateado — úsalo directamente, no calcules el día de la semana tú mismo. Si el paciente pidió una fecha exacta, usa preferred_date en vez de skip_days. Si el paciente prefiere mañana o tarde, usa time_of_day. En modo normal (no overview), como devuelve la lista completa del día, puedes verificar con certeza si una hora específica que pida el paciente (ej. '¿a las 3pm hay?') está o no en el resultado — nunca respondas que no hay disponibilidad sin haber consultado esta tool para esa hora exacta.",
    inputSchema: z.object({
      service: z.string().describe("Nombre del servicio a agendar"),
      days_ahead: z
        .number()
        .optional()
        .describe("Días hacia adelante a buscar (default 7)"),
      is_urgent: z
        .boolean()
        .optional()
        .describe(
          "Si true, busca solo en las próximas 24h y devuelve máximo 1 slot"
        ),
      skip_days: z
        .number()
        .optional()
        .describe(
          "Días a saltar antes de empezar a buscar. Úsalo solo cuando el paciente pide 'otro día' o 'más adelante' sin especificar cuál (default 0)."
        ),
      preferred_date: z
        .string()
        .optional()
        .describe(
          "Fecha exacta que pidió el paciente, en formato YYYY-MM-DD (zona horaria de la clínica). Úsala siempre que el paciente mencione un día específico (ej. 'el viernes 10 de julio') — es más confiable que skip_days porque no depende de que tú recuerdes cuántos días llevas saltando en la conversación. Si se da, tiene prioridad sobre skip_days."
        ),
      time_of_day: z
        .enum(["mañana", "tarde"])
        .optional()
        .describe(
          "Si el paciente prefiere mañana o tarde, fíltralo aquí. Sin esto, en modo normal la tool solo devuelve los horarios del día que casi siempre caen en la mañana — usar time_of_day es la única forma de encontrar horarios de tarde en un día con jornada larga."
        ),
      overview: z
        .boolean()
        .optional()
        .describe(
          "Ponlo en true cuando el paciente haga una pregunta ABIERTA sobre disponibilidad, sin pedir un día puntual (ej. '¿qué días tienes disponibilidad?', 'dime tú qué días tienes'). Devuelve un par de horarios de cada uno de varios días distintos en vez de un solo día — así no tienes que repetir el mismo día una y otra vez esperando que el paciente insista."
        ),
    }),
    execute: async ({
      service,
      days_ahead = 7,
      is_urgent = false,
      skip_days = 0,
      preferred_date,
      time_of_day,
      overview = false,
    }) => {
      const db = createServiceClient();

      const { data: rawConfig } = await db
        .from("agent_configs")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .maybeSingle() con tipos manuales
      const config = rawConfig as AgentConfig | null;

      const { data: rawOrg } = await db
        .from("organizations")
        .select("*")
        .eq("id", organizationId)
        .maybeSingle();
      // DECISION: mismo patrón de cast
      const org = rawOrg as Organization | null;

      const timezone = org?.timezone ?? "America/Bogota";
      // DECISION: double cast (unknown) necesario — Json no es directamente asignable a BusinessHours/ServiceConfig[]
      const businessHours = (config?.business_hours ?? {}) as unknown as BusinessHours;
      const services = (config?.services ?? []) as unknown as ServiceConfig[];

      if (Object.keys(businessHours).length === 0) {
        return {
          error:
            "No hay horarios de atención configurados. El administrador debe configurarlos en Personalización.",
        };
      }

      let now: Date;
      if (preferred_date) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(preferred_date);
        if (!match) {
          return {
            error: `Formato de preferred_date inválido: "${preferred_date}". Usa YYYY-MM-DD.`,
          };
        }
        const [y, m, d] = [
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
        ];
        const preferredMidnightUTC = localToUTC(y, m, d, 0, 0, timezone);
        // If the preferred date is today, anchor on the real current time
        // (so we don't offer slots earlier than now); otherwise anchor on
        // midnight of that day so the search starts right at it.
        now = new Date(Math.max(Date.now(), preferredMidnightUTC.getTime()));
      } else {
        now = new Date(Date.now() + skip_days * 24 * 60 * 60 * 1000);
      }
      const durationMin = getServiceDuration(service, services);
      const rawSlots = generateSlots(
        businessHours,
        durationMin,
        days_ahead,
        timezone,
        is_urgent,
        now,
        time_of_day,
        overview
      );

      let slots = rawSlots;
      const windowDays = is_urgent ? 2 : days_ahead;
      const timeMin = now;
      const timeMax = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
      const durationMs = durationMin * 60 * 1000;

      // Chequeo directo contra nuestra propia tabla appointments — el
      // respaldo base, independiente de Google Calendar. Incidente real
      // 2026-07-13: Kevin Cano y Dairo Cano quedaron agendados a la misma
      // hora porque este tool solo excluía horarios ocupados vía Calendar
      // FreeBusy; cuando el token de Calendar de la organización murió de
      // forma silenciosa, ninguna cita ya agendada volvió a excluirse.
      if (rawSlots.length > 0) {
        const { data: existingAppts } = await db
          .from("appointments")
          .select("starts_at, ends_at")
          .eq("organization_id", organizationId)
          .neq("status", "cancelled")
          .gte("starts_at", timeMin.toISOString())
          .lte("starts_at", timeMax.toISOString());

        const dbBusyPeriods: BusyPeriod[] = (
          (existingAppts ?? []) as { starts_at: string; ends_at: string }[]
        ).map((a) => ({ start: new Date(a.starts_at), end: new Date(a.ends_at) }));

        if (dbBusyPeriods.length > 0) {
          slots = slots.filter(
            (iso) => !isSlotBusy(new Date(iso), durationMs, dbBusyPeriods)
          );
        }
      }

      // Filter by Google Calendar FreeBusy if the org has it configured —
      // capa adicional para eventos externos que no pasaron por nuestra
      // tabla appointments (ej. el odontólogo bloqueó un espacio manualmente).
      const gcal = await getGoogleCalendarContext(organizationId).catch(() => null);
      if (gcal && slots.length > 0) {
        try {
          const busyPeriods = await getFreeBusy(gcal.accessToken, gcal.calendarId, timeMin, timeMax);
          if (busyPeriods.length > 0) {
            slots = slots.filter(
              (iso) => !isSlotBusy(new Date(iso), durationMs, busyPeriods)
            );
          }
        } catch {
          // FreeBusy failed — el chequeo contra appointments ya cubrió la
          // garantía base; no bloqueamos la reserva por esto.
          console.error(
            JSON.stringify({ event: "freebusy_error", organization_id: organizationId })
          );
        }
      }

      if (slots.length === 0) {
        return {
          slots: [],
          message: time_of_day
            ? `No hay disponibilidad en la ${time_of_day} para el período solicitado. Intenta sin time_of_day, con más días, o con el otro horario del día.`
            : "No hay disponibilidad en el período solicitado. Intenta con más días o un horario diferente.",
        };
      }

      const labeledSlots = slots.map((iso) => ({
        iso,
        label: new Intl.DateTimeFormat("es-CO", {
          timeZone: timezone,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(new Date(iso)),
      }));

      return { slots: labeledSlots, duration_minutes: durationMin };
    },
  });
}
