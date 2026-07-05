import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Organization } from "@/lib/database.types";
import { CalendarView } from "./_components/calendar-view";

// Force dynamic rendering — appointments change constantly (nueva cita por
// WhatsApp puede llegar en cualquier momento) and this page must always
// reflect the real state of the DB, never a cached render.
export const dynamic = "force-dynamic";

export default async function CitasPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
  const profile = rawProfile as Pick<Profile, "organization_id"> | null;
  const organizationId = profile?.organization_id;
  if (!organizationId) redirect("/login");

  const { data: rawOrg } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .single();
  // DECISION: cast necesario — mismo patrón
  const org = rawOrg as Pick<Organization, "timezone"> | null;
  const timezone = org?.timezone ?? "America/Bogota";

  const now = new Date();
  const year = Math.max(
    2020,
    Math.min(2099, parseInt(params.year ?? "") || now.getFullYear())
  );
  const month = Math.max(
    1,
    Math.min(12, parseInt(params.month ?? "") || now.getMonth() + 1)
  );

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endOfMonth = new Date(
    Date.UTC(year, month, 0, 23, 59, 59)
  ).toISOString();

  const { data: rawAppts } = await supabase
    .from("appointments")
    .select(
      "id, service, starts_at, ends_at, status, is_urgent, is_new_patient, full_name, phone, medical_notes"
    )
    .eq("organization_id", organizationId)
    .gte("starts_at", startOfMonth)
    .lte("starts_at", endOfMonth)
    .order("starts_at", { ascending: true });

  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para select parcial con tipos manuales
  const appointments = (rawAppts ?? []) as Array<{
    id: string;
    service: string;
    starts_at: string;
    ends_at: string;
    status: string | null;
    is_urgent: boolean | null;
    is_new_patient: boolean | null;
    full_name: string;
    phone: string;
    medical_notes: string | null;
  }>;

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-slate-900 mb-6">Citas</h1>
        <CalendarView
          appointments={appointments}
          timezone={timezone}
          year={year}
          month={month}
        />
      </div>
    </div>
  );
}
