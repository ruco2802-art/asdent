"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { encrypt, decrypt } from "@/lib/crypto";
import { GRAPH_API_VERSION } from "@/lib/whatsapp/send";
import type { Profile, WhatsappConfig } from "@/lib/database.types";

export type IntegrationState = {
  error?: string;
  success?: boolean;
  message?: string;
};

async function getAuthContext(): Promise<{ orgId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: raw } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const profile = raw as Profile | null;
  if (!profile?.organization_id) return null;
  return { orgId: profile.organization_id };
}

export async function saveWhatsappConfigAction(
  _prev: IntegrationState,
  formData: FormData
): Promise<IntegrationState> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado o sin organización" };

  const phoneNumberId = (formData.get("phone_number_id") as string).trim();
  const wabaId = (formData.get("waba_id") as string).trim();
  const verifyToken = (formData.get("verify_token") as string).trim();
  const accessToken = (formData.get("access_token") as string).trim();
  const appSecret = (formData.get("app_secret") as string).trim();

  if (!phoneNumberId || !wabaId || !verifyToken) {
    return { error: "Phone Number ID, WABA ID y Verify Token son requeridos" };
  }

  // Leer valores cifrados existentes para mantenerlos si el usuario no los re-ingresa
  const service = createServiceClient();
  const { data: raw } = await service
    .from("whatsapp_configs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const existing = raw as WhatsappConfig | null;

  let accessTokenEncrypted = existing?.access_token_encrypted;
  let appSecretEncrypted = existing?.app_secret_encrypted;

  if (accessToken) {
    try {
      accessTokenEncrypted = encrypt(accessToken);
    } catch {
      return {
        error:
          "Error al cifrar el token. Verifica que ENCRYPTION_KEY esté configurado en .env.local",
      };
    }
  }
  if (appSecret) {
    try {
      appSecretEncrypted = encrypt(appSecret);
    } catch {
      return {
        error:
          "Error al cifrar el App Secret. Verifica que ENCRYPTION_KEY esté configurado en .env.local",
      };
    }
  }

  if (!accessTokenEncrypted || !appSecretEncrypted) {
    return {
      error:
        "Access Token y App Secret son requeridos en la primera configuración",
    };
  }

  const { error: upsertError } = await service
    .from("whatsapp_configs")
    .upsert(
      {
        organization_id: ctx.orgId,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        access_token_encrypted: accessTokenEncrypted,
        verify_token: verifyToken,
        app_secret_encrypted: appSecretEncrypted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );

  if (upsertError) return { error: `Error al guardar: ${upsertError.message}` };
  return { success: true, message: "Configuración de WhatsApp guardada." };
}

export async function testWhatsappConnectionAction(): Promise<IntegrationState> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado" };

  const service = createServiceClient();
  const { data: raw } = await service
    .from("whatsapp_configs")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (!raw) return { error: "Guarda la configuración de WhatsApp primero." };
  const config = raw as WhatsappConfig;

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token_encrypted);
  } catch {
    return {
      error:
        "Error al descifrar el token. Verifica ENCRYPTION_KEY en .env.local",
    };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${config.phone_number_id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        error: `Error de Meta: ${body.error?.message ?? `HTTP ${res.status}`}`,
      };
    }

    const data = (await res.json()) as {
      display_phone_number?: string;
      verified_name?: string;
    };
    return {
      success: true,
      message: `Conexión exitosa. Número: ${data.display_phone_number ?? "—"} (${data.verified_name ?? "sin nombre"})`,
    };
  } catch (err) {
    return {
      error: `Error de red: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function connectGoogleCalendarAction(): Promise<
  { url: string } | IntegrationState
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return {
      error:
        "Faltan GOOGLE_CLIENT_ID o GOOGLE_OAUTH_REDIRECT_URI en .env.local",
    };
  }

  const nonce = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("google_oauth_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutos
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar",
    access_type: "offline",
    prompt: "consent", // fuerza refresh_token en cada autorización
    state: nonce,
  });

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  };
}

export async function saveCalendarIdAction(
  _prev: IntegrationState,
  formData: FormData
): Promise<IntegrationState> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "No autenticado" };

  const calendarId = (formData.get("calendar_id") as string).trim();
  if (!calendarId) return { error: "Selecciona un calendario" };

  const service = createServiceClient();
  const { error } = await service
    .from("google_calendar_configs")
    .update({ calendar_id: calendarId, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.orgId);

  if (error) return { error: `Error al guardar: ${error.message}` };
  return { success: true, message: "Calendario guardado." };
}
