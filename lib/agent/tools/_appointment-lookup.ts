import { createServiceClient } from "@/lib/supabase/service";

export interface UpcomingAppointment {
  id: string;
  service: string;
  starts_at: string;
  ends_at: string;
  google_event_id: string | null;
  full_name: string;
  is_new_patient: boolean | null;
  is_urgent: boolean | null;
  medical_notes: string | null;
  notes: string | null;
}

export type AppointmentLookupResult =
  | { kind: "none" }
  | { kind: "ambiguous"; appointments: UpcomingAppointment[] }
  | { kind: "found"; appointment: UpcomingAppointment };

// Shared by cancel_appointment and reschedule_appointment: the agent never
// has a raw appointment UUID to work with (there's no "list my appointments"
// tool), so both look up the patient's own upcoming appointment(s) by
// contact instead. If there's more than one, the caller asks the patient
// which one and re-calls with `hintStartsAt` to disambiguate.
export async function findUpcomingAppointment(
  organizationId: string,
  contactId: string,
  hintStartsAt?: string
): Promise<AppointmentLookupResult> {
  const db = createServiceClient();
  const { data } = await db
    .from("appointments")
    .select(
      "id, service, starts_at, ends_at, google_event_id, full_name, is_new_patient, is_urgent, medical_notes, notes"
    )
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("status", "confirmed")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  const appointments = (data ?? []) as UpcomingAppointment[];

  if (appointments.length === 0) return { kind: "none" };
  if (appointments.length === 1) return { kind: "found", appointment: appointments[0] };

  if (hintStartsAt) {
    const hintMs = new Date(hintStartsAt).getTime();
    const match = appointments.find(
      (a) => new Date(a.starts_at).getTime() === hintMs
    );
    if (match) return { kind: "found", appointment: match };
  }

  return { kind: "ambiguous", appointments };
}
