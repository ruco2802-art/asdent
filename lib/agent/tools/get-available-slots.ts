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

function generateSlots(
  businessHours: BusinessHours,
  durationMin: number,
  daysAhead: number,
  timezone: string,
  isUrgent: boolean,
  now: Date
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
      const end = eh * 60 + (em ?? 0);

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
      "Devuelve slots de tiempo disponibles para agendar una cita, filtrando con Google Calendar FreeBusy si está configurado. Si is_urgent=true devuelve 1 slot (el más próximo en 24h); si no, devuelve hasta 3 slots en los próximos days_ahead días. Cada slot incluye un 'label' en español ya formateado — úsalo directamente, no calcules el día de la semana tú mismo.",
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
          "Días a saltar antes de empezar a buscar. Úsalo cuando el paciente ya rechazó los slots ofrecidos anteriormente y quiere otro día (default 0)."
        ),
    }),
    execute: async ({ service, days_ahead = 7, is_urgent = false, skip_days = 0 }) => {
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

      const now = new Date(Date.now() + skip_days * 24 * 60 * 60 * 1000);
      const durationMin = getServiceDuration(service, services);
      const rawSlots = generateSlots(
        businessHours,
        durationMin,
        days_ahead,
        timezone,
        is_urgent,
        now
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
          message:
            "No hay disponibilidad en el período solicitado. Intenta con más días o un horario diferente.",
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
