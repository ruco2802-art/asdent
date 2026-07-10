import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createAlert } from "@/lib/alerts";
import {
  sendWhatsAppTemplate,
  getConfirmationTemplateName,
  getConfirmationTemplateLanguage,
} from "@/lib/whatsapp/send-template";
import type { Organization } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 1 envío inicial + máximo 2 reintentos = 3 intentos en total antes de at_risk
const MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 4 * 60 * 60 * 1000;
const QUIET_HOUR_START = 20; // 8pm
const QUIET_HOUR_END = 8; // 8am

interface AppointmentRow {
  id: string;
  organization_id: string;
  contact_id: string;
  full_name: string;
  phone: string;
  service: string;
  starts_at: string;
  confirmation_status: string;
  confirmation_sent_at: string | null;
  confirmation_attempts: number;
}

function localHour(date: Date, tz: string): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hourCycle: "h23",
    }).format(date)
  );
}

function isQuietHour(hour: number): boolean {
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

function localDateParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Días de calendario (no horas) entre "ahora" y la cita, en la zona horaria
// de la clínica — para que la tabla de anticipación (3+ días / 1-2 días /
// mismo día) hable de días reales del paciente, no de bloques de 24h.
function calendarDaysUntil(now: Date, startsAt: Date, tz: string): number {
  const a = localDateParts(now, tz);
  const b = localDateParts(startsAt, tz);
  const aUTC = Date.UTC(a.year, a.month - 1, a.day);
  const bUTC = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bUTC - aUTC) / (24 * 60 * 60 * 1000));
}

function leadHoursFor(daysUntil: number): number {
  if (daysUntil >= 3) return 24;
  if (daysUntil >= 1) return 8;
  return 2.5; // mismo día — punto medio de la ventana "2-3h antes"
}

export async function GET(request: NextRequest) {
  // Vercel agrega este header automáticamente en los cron jobs configurados
  // en vercel.json cuando CRON_SECRET está seteado en el proyecto.
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = createServiceClient();
  const now = new Date();
  const results = { sent: 0, retried: 0, at_risk: 0, skipped_quiet_hours: 0, skipped_no_template: 0, errors: 0 };

  const timezoneCache = new Map<string, string>();
  async function getTimezone(orgId: string): Promise<string> {
    const cached = timezoneCache.get(orgId);
    if (cached) return cached;
    const { data } = await db
      .from("organizations")
      .select("timezone")
      .eq("id", orgId)
      .maybeSingle();
    const tz = (data as Pick<Organization, "timezone"> | null)?.timezone ?? "America/Bogota";
    timezoneCache.set(orgId, tz);
    return tz;
  }

  async function findConversationId(organizationId: string, contactId: string): Promise<string | null> {
    const { data } = await db
      .from("conversations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  // Envía (o reintenta) la confirmación de una cita. No cuenta como intento
  // si el template todavía no está configurado — así no se pierden citas
  // mientras se espera la aprobación de Meta.
  async function sendConfirmationAttempt(appt: AppointmentRow, tz: string): Promise<boolean> {
    const templateName = getConfirmationTemplateName();
    if (!templateName) {
      results.skipped_no_template++;
      console.warn(
        JSON.stringify({
          event: "confirmation_template_not_configured",
          appointment_id: appt.id,
        })
      );
      return false;
    }

    const dateLabel = new Intl.DateTimeFormat("es-CO", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(appt.starts_at));

    const wamid = await sendWhatsAppTemplate(
      appt.organization_id,
      appt.phone,
      templateName,
      getConfirmationTemplateLanguage(),
      [appt.full_name.split(" ")[0], dateLabel]
    );

    await db
      .from("appointments")
      .update({
        confirmation_status: "awaiting_confirmation",
        confirmation_sent_at: now.toISOString(),
        confirmation_attempts: appt.confirmation_attempts + 1,
      })
      .eq("id", appt.id);

    const conversationId = await findConversationId(appt.organization_id, appt.contact_id);
    if (conversationId) {
      await db.from("messages").insert({
        conversation_id: conversationId,
        organization_id: appt.organization_id,
        wa_message_id: wamid,
        direction: "outbound",
        sender: "bot",
        content: `[Plantilla de confirmación] Hola ${appt.full_name.split(" ")[0]}, te recordamos tu cita el ${dateLabel}.`,
        created_at: now.toISOString(),
      });
    }

    return true;
  }

  // ── 1. pending → primer envío ──────────────────────────────────────────
  const { data: rawPending } = await db
    .from("appointments")
    .select(
      "id, organization_id, contact_id, full_name, phone, service, starts_at, confirmation_status, confirmation_sent_at, confirmation_attempts"
    )
    .eq("status", "confirmed")
    .eq("confirmation_status", "pending")
    .gte("starts_at", now.toISOString());

  for (const appt of (rawPending ?? []) as AppointmentRow[]) {
    try {
      const tz = await getTimezone(appt.organization_id);
      const startsAt = new Date(appt.starts_at);
      const daysUntil = calendarDaysUntil(now, startsAt, tz);
      const leadHours = leadHoursFor(daysUntil);
      const idealSendAt = new Date(startsAt.getTime() - leadHours * 60 * 60 * 1000);

      if (now.getTime() < idealSendAt.getTime()) continue; // aún no toca

      if (isQuietHour(localHour(now, tz))) {
        results.skipped_quiet_hours++;
        continue; // se reintenta en el siguiente tick, después de las 8am
      }

      const sent = await sendConfirmationAttempt(appt, tz);
      if (sent) results.sent++;
    } catch (err) {
      results.errors++;
      console.error(
        JSON.stringify({
          event: "confirmation_send_error",
          appointment_id: appt.id,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  // ── 2. awaiting_confirmation → reintento o at_risk ─────────────────────
  const { data: rawAwaiting } = await db
    .from("appointments")
    .select(
      "id, organization_id, contact_id, full_name, phone, service, starts_at, confirmation_status, confirmation_sent_at, confirmation_attempts"
    )
    .eq("status", "confirmed")
    .eq("confirmation_status", "awaiting_confirmation")
    .gte("starts_at", now.toISOString());

  for (const appt of (rawAwaiting ?? []) as AppointmentRow[]) {
    try {
      if (!appt.confirmation_sent_at) continue;
      const elapsed = now.getTime() - new Date(appt.confirmation_sent_at).getTime();
      if (elapsed < RETRY_INTERVAL_MS) continue; // todavía dentro de la ventana de 4h

      const tz = await getTimezone(appt.organization_id);

      if (appt.confirmation_attempts >= MAX_ATTEMPTS) {
        await db
          .from("appointments")
          .update({ confirmation_status: "at_risk" })
          .eq("id", appt.id);

        const conversationId = await findConversationId(appt.organization_id, appt.contact_id);
        const dateLabel = new Intl.DateTimeFormat("es-CO", {
          timeZone: tz,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(new Date(appt.starts_at));

        await createAlert({
          organizationId: appt.organization_id,
          type: "appointment_at_risk",
          appointmentId: appt.id,
          conversationId: conversationId ?? undefined,
          message: `${appt.full_name} no confirmó su cita de ${appt.service} (${dateLabel}) después de ${MAX_ATTEMPTS} intentos — contáctalo directamente.`,
        });
        results.at_risk++;
        continue;
      }

      if (isQuietHour(localHour(now, tz))) {
        results.skipped_quiet_hours++;
        continue;
      }

      const sent = await sendConfirmationAttempt(appt, tz);
      if (sent) results.retried++;
    } catch (err) {
      results.errors++;
      console.error(
        JSON.stringify({
          event: "confirmation_retry_error",
          appointment_id: appt.id,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  console.log(JSON.stringify({ event: "appointment_confirmations_cron_done", ...results }));
  return Response.json(results);
}
