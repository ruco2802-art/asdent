import type { BusyPeriod } from "@/lib/google-calendar";

export interface ServiceConfig {
  name: string;
  duration_minutes?: number;
}

export function isSlotBusy(
  slotStart: Date,
  durationMs: number,
  busyPeriods: BusyPeriod[]
): boolean {
  const slotEnd = new Date(slotStart.getTime() + durationMs);
  return busyPeriods.some((b) => slotStart < b.end && slotEnd > b.start);
}

export type TimePeriod = { start: string; end: string };
export type BusinessHours = Record<string, TimePeriod[]>;

// Default service durations for a dental clinic (minutes)
const DEFAULT_DURATIONS: Record<string, number> = {
  consulta: 30, revisión: 30, revision: 30,
  limpieza: 45, profilaxis: 45,
  empaste: 60, obturación: 60, obturacion: 60,
  extracción: 45, extraccion: 45,
  juicio: 90, blanqueamiento: 90,
  ortodoncia: 30, brackets: 30,
  endodoncia: 90, conducto: 90,
  implante: 60,
  urgencia: 30, dolor: 30,
};

export function getServiceDuration(
  serviceName: string,
  services: ServiceConfig[]
): number {
  const lower = serviceName.toLowerCase();
  for (const s of services) {
    if (
      s.duration_minutes &&
      (s.name.toLowerCase() === lower ||
        lower.includes(s.name.toLowerCase()))
    ) {
      return s.duration_minutes;
    }
  }
  for (const [keyword, dur] of Object.entries(DEFAULT_DURATIONS)) {
    if (lower.includes(keyword)) return dur;
  }
  return 30;
}

// Returns the 3-letter weekday key ("mon"..."sun") for a Date in a given timezone
export function getWeekdayInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(date)
    .toLowerCase()
    .slice(0, 3);
}

export function getDatePartsInTz(
  date: Date,
  tz: string
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Converts a local clock time in 'tz' to a UTC Date using the Intl offset trick
export function localToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  // Treat local time as UTC to get an approximate UTC instant
  const approx = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Format it in 'tz' to find what local time the approx UTC actually is
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(approx);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0");

  const localAsUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  // offsetMs = how far the approx UTC drifted from the actual local clock
  const offsetMs = approx.getTime() - localAsUTC;
  return new Date(approx.getTime() + offsetMs);
}
