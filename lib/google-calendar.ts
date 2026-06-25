import { createServiceClient } from "@/lib/supabase/service";
import { encrypt, decrypt } from "@/lib/crypto";
import type { GoogleCalendarConfig } from "@/lib/database.types";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
// Refresh 5 minutes before actual expiry to avoid edge cases
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ─── Token management ─────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured");
  }

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "unknown");
    throw new Error(`Google token refresh ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token in Google refresh response");
  return data.access_token;
}

/**
 * Returns a valid Google Calendar access token + calendar ID for an org,
 * refreshing the token automatically if it has expired.
 * Returns null if the org has no Google Calendar configured.
 */
export async function getGoogleCalendarContext(
  organizationId: string
): Promise<{ accessToken: string; calendarId: string } | null> {
  const db = createServiceClient();
  const { data: raw } = await db
    .from("google_calendar_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .maybeSingle() con tipos manuales
  const config = raw as GoogleCalendarConfig | null;

  if (!config?.refresh_token_encrypted || !config.calendar_id) return null;

  const now = Date.now();
  const expiresAt = config.token_expires_at
    ? new Date(config.token_expires_at).getTime()
    : 0;

  // Use cached access token if still valid
  if (config.access_token_encrypted && expiresAt > now + EXPIRY_BUFFER_MS) {
    try {
      return {
        accessToken: decrypt(config.access_token_encrypted),
        calendarId: config.calendar_id,
      };
    } catch {
      // Decryption failed — fall through to refresh
    }
  }

  // Refresh the token
  const refreshToken = decrypt(config.refresh_token_encrypted);
  const newAccessToken = await refreshAccessToken(refreshToken);

  // Persist the new token (best-effort — don't fail if DB update fails)
  const newExpiry = new Date(now + 3600 * 1000).toISOString(); // 1 hour
  try {
    await db
      .from("google_calendar_configs")
      .update({
        access_token_encrypted: encrypt(newAccessToken),
        token_expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId);
  } catch {
    // ignore — token still usable in memory even if DB write fails
  }

  return { accessToken: newAccessToken, calendarId: config.calendar_id };
}

// ─── FreeBusy ────────────────────────────────────────────────────────────────

export interface BusyPeriod {
  start: Date;
  end: Date;
}

interface FreeBusyResponse {
  calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
}

export async function getFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusyPeriod[]> {
  const res = await fetch(`${GOOGLE_CALENDAR_BASE}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Google FreeBusy ${res.status}`);
  }

  const body = (await res.json()) as FreeBusyResponse;
  return (body.calendars?.[calendarId]?.busy ?? []).map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }));
}

// ─── Create event ─────────────────────────────────────────────────────────────

export interface CreateEventInput {
  summary: string;
  description?: string;
  startsAt: string; // ISO 8601 UTC
  endsAt: string; // ISO 8601 UTC
  timezone: string; // IANA, e.g. "America/Bogota"
  isUrgent?: boolean;
}

interface CalendarEventResponse {
  id?: string;
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: CreateEventInput
): Promise<string> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    start: { dateTime: input.startsAt, timeZone: input.timezone },
    end: { dateTime: input.endsAt, timeZone: input.timezone },
  };

  // Tomato (11) for urgent; regular appointments use the calendar's default color
  if (input.isUrgent) body.colorId = "11";

  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Google Calendar createEvent ${res.status}: ${errText}`);
  }

  const event = (await res.json()) as CalendarEventResponse;
  if (!event.id) throw new Error("Google Calendar createEvent: no event ID in response");
  return event.id;
}
