"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function updateAppointmentStatusAction(
  formData: FormData
): Promise<{ error?: string }> {
  const appointmentId = formData.get("appointmentId") as string | null;
  const status = formData.get("status") as string | null;

  const validStatuses = ["confirmed", "cancelled", "completed"];
  if (!appointmentId || !status || !validStatuses.includes(status)) {
    return { error: "Parámetros inválidos" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado" };

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
  const orgId = (rawProfile as { organization_id: string | null } | null)
    ?.organization_id;
  if (!orgId) return { error: "Sin organización" };

  // DECISION: usar service client para .update() — createServerClient infiere never para el argumento
  const service = createServiceClient();
  const { error } = await service
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId)
    .eq("organization_id", orgId);

  if (error) return { error: "Error al actualizar la cita" };
  return {};
}
