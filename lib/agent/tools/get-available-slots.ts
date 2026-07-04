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
} from "./_utils";

function isSlotBusy(
  slotStart: Date,
  durationMs: number,
  busyPeriods: BusyPeriod[]
): boolean {
  const slotEnd = new Date(slotStart.getTime() + durationMs);
  return busyPeriods.some((b) => slotStart < b.end && slotEnd > b.start);
}

type TimeOfDay = "mañana" | "tarde";
const NOON_MIN = 12 * 60;

function generateSlots(
  businessHours: BusinessHours,
  durationMin: number,
  daysAhead: number,
  timezone: string,
  isUrgent: boolean,
  now: Date,
  timeOfDay?: TimeOfDay
): string[] {
  const slots: string[] = [];
  const limit = isUrgent ? 1 : 3;
  // Urgent = look 2 days (~48h) at most to find 1 slot in the next 24h
  const maxDays = isUrgent ? 2 : daysAhead;
  const urgentCutoff = now.getTime() + 24 * 60 * 60 * 1000;
  // 30-min buffer so we never offer a slot that starts in the next 30 minutes
  const earliest = now.getTime() + 30 * 60 * 1000;

  for (let d = 0; d < maxDays && slots.length < limit; d++) {
    const dayStart = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    const weekday = getWeekdayInTz(dayStart, timezone);
    const periods = businessHours[weekday] ?? [];
    const { year, month, day } = getDatePartsInTz(dayStart, timezone);

    for (const period of periods) {
      const [sh, sm] = period.start.split(":").map(Number);
      const [eh, em] = period.end.split(":").map(Number);
      let cur = sh * 60 + (sm ?? 0);
      let end = eh * 60 + (em ?? 0);
      // Clamp the period to the requested half of the day. Without this,
      // the limit below (3 total slots) always gets filled by the earliest
      // chronological slots — which are always in the morning whenever
      // business hours open early — so an afternoon preference could never
      // surface even when the day has plenty of afternoon availability.
      if (timeOfDay === "mañana") end = Math.min(end, NOON_MIN);
      if (timeOfDay === "tarde") cur = Math.max(cur, NOON_MIN);

      while (cur + durationMin <= end && slots.length < limit) {
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
          slots.push(slotUTC.toISOString());
        }
        cur += 30; // 30-min grid
      }
    }
  }

  return slots;
}

export function createGetAvailableSlotsTool(organizationId: string) {
  return tool({
    description:
      "Devuelve slots de tiempo disponibles para agendar una cita, filtrando con Google Calendar FreeBusy si está configurado. Si is_urgent=true devuelve 1 slot (el más próximo en 24h); si no, devuelve hasta 3 slots en los próximos days_ahead días. Cada slot incluye un 'label' en español ya formateado — úsalo directamente, no calcules el día de la semana tú mismo. Si el paciente pidió una fecha exacta, usa preferred_date en vez de skip_days. Si el paciente prefiere mañana o tarde, usa time_of_day.",
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
          "Si el paciente prefiere mañana o tarde, fíltralo aquí. Sin esto, la tool solo devuelve los 3 horarios más tempranos del día (que casi siempre caen en la mañana) — usar time_of_day es la única forma de encontrar horarios de tarde en un día con jornada larga."
        ),
    }),
    execute: async ({
      service,
      days_ahead = 7,
      is_urgent = false,
      skip_days = 0,
      preferred_date,
      time_of_day,
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
        time_of_day
      );

      // Filter by Google Calendar FreeBusy if the org has it configured
      let slots = rawSlots;
      const gcal = await getGoogleCalendarContext(organizationId).catch(() => null);
      if (gcal && rawSlots.length > 0) {
        const windowDays = is_urgent ? 2 : days_ahead;
        const timeMin = now;
        const timeMax = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
        try {
          const busyPeriods = await getFreeBusy(gcal.accessToken, gcal.calendarId, timeMin, timeMax);
          if (busyPeriods.length > 0) {
            const durationMs = durationMin * 60 * 1000;
            slots = rawSlots.filter(
              (iso) => !isSlotBusy(new Date(iso), durationMs, busyPeriods)
            );
          }
        } catch {
          // FreeBusy failed — return unfiltered slots rather than blocking booking
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
