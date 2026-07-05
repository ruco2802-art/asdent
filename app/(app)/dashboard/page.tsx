import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ChatDots,
  CalendarCheck,
  Warning,
  ArrowRight,
  Robot,
  User,
} from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Organization } from "@/lib/database.types";
import { getWeekdayInTz, getDatePartsInTz, localToUTC } from "@/lib/agent/tools/_utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: "teal" | "red" | "blue" | "stone";
}

interface ConvPreview {
  id: string;
  bot_active: boolean | null;
  booking_state: string | null;
  last_message_at: string | null;
  full_name: string | null;
  wa_phone: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

const BOOKING_LABELS: Record<string, string> = {
  idle: "Sin inicio",
  collecting_service: "Eligiendo servicio",
  collecting_datetime: "Eligiendo horario",
  collecting_contact: "Datos de contacto",
  confirming: "Confirmando",
  booked: "Agendada",
  handoff: "Traspaso",
};

const ACCENT_CLASSES: Record<string, string> = {
  teal: "bg-teal-50 text-teal-600",
  red: "bg-red-50 text-red-600",
  blue: "bg-blue-50 text-blue-600",
  stone: "bg-stone-100 text-stone-500",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, accent = "teal" }: KpiCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5 flex items-start gap-4">
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ACCENT_CLASSES[accent]}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-900 leading-none mb-1">
          {value}
        </p>
        <p className="text-sm text-stone-500">{label}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("organization_id, full_name")
    .eq("id", user.id)
    .single();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
  const profile = rawProfile as Pick<
    Profile,
    "organization_id" | "full_name"
  > | null;
  const organizationId = profile?.organization_id;
  if (!organizationId) redirect("/login");

  const { data: rawOrg } = await supabase
    .from("organizations")
    .select("name, timezone")
    .eq("id", organizationId)
    .single();
  // DECISION: cast necesario — mismo patrón
  const org = rawOrg as Pick<Organization, "name" | "timezone"> | null;
  const timezone = org?.timezone ?? "America/Bogota";

  // ── Date boundaries ──
  // Computed in the clinic's own timezone, not the server's raw clock
  // (Vercel runs in UTC) — otherwise "today" and "this week" roll over up
  // to 5 hours before they actually do in the clinic's local time.
  const now = new Date();
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const last7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const WEEKDAY_INDEX: Record<string, number> = {
    mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
  };
  const { year, month, day } = getDatePartsInTz(now, timezone);
  const todayIndex = WEEKDAY_INDEX[getWeekdayInTz(now, timezone)] ?? 0;

  const weekStart = localToUTC(year, month, day - todayIndex, 0, 0, timezone);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  // ── Parallel KPI queries ──
  const [
    { count: totalConvs },
    { count: confirmedThisWeek },
    { count: urgentLast7 },
    { count: handoffActive },
    { data: rawConvs },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", last30),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .gte("starts_at", weekStart.toISOString())
      .lte("starts_at", weekEnd.toISOString()),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_urgent", true)
      .gte("created_at", last7),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("booking_state", "handoff")
      .eq("bot_active", false),
    supabase
      .from("conversations")
      .select(
        `id, bot_active, booking_state, last_message_at,
         contacts!inner(wa_phone, full_name)`
      )
      .eq("organization_id", organizationId)
      .order("last_message_at", { ascending: false })
      .limit(5),
  ]);

  // DECISION: cast necesario — join inference con tipos manuales infiere never
  const conversations = ((rawConvs ?? []) as unknown[]).map((c) => {
    const row = c as {
      id: string;
      bot_active: boolean | null;
      booking_state: string | null;
      last_message_at: string | null;
      contacts:
        | { wa_phone: string; full_name: string | null }
        | { wa_phone: string; full_name: string | null }[];
    };
    const contact = Array.isArray(row.contacts)
      ? row.contacts[0]
      : row.contacts;
    return {
      id: row.id,
      bot_active: row.bot_active,
      booking_state: row.booking_state,
      last_message_at: row.last_message_at,
      full_name: contact?.full_name ?? null,
      wa_phone: contact?.wa_phone ?? "",
    } satisfies ConvPreview;
  });

  const firstName = profile?.full_name?.split(" ")[0] ?? "equipo";
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now)
  );
  const greeting =
    hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm text-stone-400 mt-0.5">
            {org?.name ?? "Panel de control"} ·{" "}
            {now.toLocaleDateString("es-CO", {
              timeZone: timezone,
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Handoff alert */}
        {(handoffActive ?? 0) > 0 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3.5">
            <Warning
              size={18}
              weight="fill"
              className="text-amber-500 flex-shrink-0"
            />
            <p className="text-sm font-medium text-amber-800">
              {handoffActive} conversación
              {(handoffActive ?? 0) > 1 ? "es" : ""} esperando atención humana
            </p>
            <Link
              href="/conversaciones"
              className="ml-auto flex items-center gap-1 text-sm font-semibold text-amber-700 hover:text-amber-900 transition-colors flex-shrink-0"
            >
              Ver
              <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={<ChatDots size={20} weight="fill" />}
            label="Conversaciones (30 días)"
            value={totalConvs ?? 0}
            accent="teal"
          />
          <KpiCard
            icon={<CalendarCheck size={20} weight="fill" />}
            label="Citas confirmadas esta semana"
            value={confirmedThisWeek ?? 0}
            accent="blue"
          />
          <KpiCard
            icon={<Warning size={20} weight="fill" />}
            label="Urgencias (7 días)"
            value={urgentLast7 ?? 0}
            accent={(urgentLast7 ?? 0) > 0 ? "red" : "stone"}
          />
          <KpiCard
            icon={<User size={20} weight="fill" />}
            label="Esperando atención humana"
            value={handoffActive ?? 0}
            accent={(handoffActive ?? 0) > 0 ? "red" : "stone"}
          />
        </div>

        {/* Recent conversations */}
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-slate-800">
              Conversaciones recientes
            </h2>
            <Link
              href="/conversaciones"
              className="flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700 transition-colors"
            >
              Ver todas
              <ArrowRight size={12} />
            </Link>
          </div>

          {conversations.length === 0 ? (
            <div className="py-10 text-center text-sm text-stone-400">
              No hay conversaciones aún
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/conversaciones/${c.id}`}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-stone-50 transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-stone-500">
                      {c.full_name
                        ? c.full_name.charAt(0).toUpperCase()
                        : c.wa_phone.slice(-2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {c.full_name ?? c.wa_phone}
                      </p>
                      <p className="text-xs text-stone-400 truncate">
                        {BOOKING_LABELS[c.booking_state ?? "idle"] ??
                          c.booking_state}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {c.booking_state === "handoff" && (
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                      )}
                      {c.bot_active ? (
                        <Robot
                          size={14}
                          weight="fill"
                          className="text-teal-500"
                        />
                      ) : (
                        <User
                          size={14}
                          weight="fill"
                          className="text-blue-400"
                        />
                      )}
                      {c.last_message_at && (
                        <span className="text-xs text-stone-400">
                          {timeAgo(c.last_message_at)}
                        </span>
                      )}
                      <ArrowRight
                        size={14}
                        className="text-stone-300 group-hover:text-stone-400 transition-colors"
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/citas"
            className="flex items-center gap-3 bg-white border border-stone-200 rounded-2xl px-5 py-4 hover:border-teal-300 hover:bg-teal-50/30 transition-colors group"
          >
            <CalendarCheck
              size={20}
              weight="fill"
              className="text-teal-500 flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                Calendario de citas
              </p>
              <p className="text-xs text-stone-400">Ver mes actual</p>
            </div>
            <ArrowRight
              size={15}
              className="ml-auto text-stone-300 group-hover:text-teal-500 transition-colors flex-shrink-0"
            />
          </Link>
          <Link
            href="/personalizacion"
            className="flex items-center gap-3 bg-white border border-stone-200 rounded-2xl px-5 py-4 hover:border-teal-300 hover:bg-teal-50/30 transition-colors group"
          >
            <Robot
              size={20}
              weight="fill"
              className="text-teal-500 flex-shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                Personalizar agente
              </p>
              <p className="text-xs text-stone-400">Prompt, servicios, horarios</p>
            </div>
            <ArrowRight
              size={15}
              className="ml-auto text-stone-300 group-hover:text-teal-500 transition-colors flex-shrink-0"
            />
          </Link>
        </div>
      </div>
    </div>
  );
}
