import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decrypt } from "@/lib/crypto";
import type { Profile, WhatsappConfig, GoogleCalendarConfig } from "@/lib/database.types";
import { WhatsappConfigForm } from "./_components/whatsapp-config-form";
import {
  GoogleCalendarSection,
  type GoogleCalendarItem,
} from "./_components/google-calendar-section";

export default async function IntegracionesPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const params = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const profile = rawProfile as Profile | null;
  const orgId = profile?.organization_id;

  let whatsappConfig: Pick<
    WhatsappConfig,
    "phone_number_id" | "waba_id" | "verify_token"
  > | null = null;
  let googleConfig: GoogleCalendarConfig | null = null;
  let calendars: GoogleCalendarItem[] = [];

  if (orgId) {
    const service = createServiceClient();

    // WhatsApp config — solo campos no-sensibles para pre-rellenar el form
    const { data: wa } = await service
      .from("whatsapp_configs")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    const waFull = wa as WhatsappConfig | null;
    if (waFull) {
      whatsappConfig = {
        phone_number_id: waFull.phone_number_id,
        waba_id: waFull.waba_id,
        verify_token: waFull.verify_token,
      };
    }

    // Google Calendar config
    const { data: gc } = await service
      .from("google_calendar_configs")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    googleConfig = gc as GoogleCalendarConfig | null;

    // Listar calendarios si hay token de acceso válido
    if (googleConfig?.access_token_encrypted) {
      try {
        const accessToken = decrypt(googleConfig.access_token_encrypted);
        const expiry = googleConfig.token_expires_at
          ? new Date(googleConfig.token_expires_at)
          : null;

        if (!expiry || expiry > new Date()) {
          const calRes = await fetch(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50",
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (calRes.ok) {
            const calData = (await calRes.json()) as {
              items?: GoogleCalendarItem[];
            };
            // Solo calendarios donde el usuario puede escribir
            calendars = (calData.items ?? []).filter(
              (c) =>
                c.accessRole === "owner" || c.accessRole === "writer"
            );
          }
        }
      } catch {
        // Token expirado o error de crypto — la sección mostrará opción de reconectar
      }
    }
  }

  const webhookUrl = `${
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  }/api/webhooks/whatsapp`;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Integraciones</h1>
        <p className="mt-1 text-sm text-stone-400">
          Conecta WhatsApp Business y Google Calendar para activar el agente.
        </p>
      </div>

      <WhatsappConfigForm config={whatsappConfig} webhookUrl={webhookUrl} />

      <GoogleCalendarSection
        isConnected={!!googleConfig}
        calendars={calendars}
        selectedCalendarId={googleConfig?.calendar_id ?? null}
        connectStatus={params.google}
        connectReason={params.reason}
      />
    </div>
  );
}
