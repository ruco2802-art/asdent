import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { encrypt } from "@/lib/crypto";
import type { Profile } from "@/lib/database.types";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  error?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const base = `${origin}/integraciones`;

  if (oauthError || !code || !state) {
    return NextResponse.redirect(
      `${base}?google=error&reason=${oauthError ?? "no_code"}`
    );
  }

  // Verificar nonce CSRF
  const cookieStore = await cookies();
  const savedNonce = cookieStore.get("google_oauth_nonce")?.value;
  if (!savedNonce || savedNonce !== state) {
    return NextResponse.redirect(`${base}?google=error&reason=csrf`);
  }
  cookieStore.delete("google_oauth_nonce");

  // Intercambiar código por tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      `${base}?google=error&reason=token_exchange`
    );
  }

  const tokens = (await tokenRes.json()) as GoogleTokenResponse;

  if (!tokens.refresh_token) {
    // Google solo devuelve refresh_token la primera vez que el usuario autoriza
    // (o cuando se fuerza con prompt=consent). Si falta, el usuario debe
    // revocar acceso en myaccount.google.com/permissions y reconectar.
    return NextResponse.redirect(
      `${base}?google=error&reason=no_refresh_token`
    );
  }

  // Obtener usuario autenticado
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const { data: raw } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const profile = raw as Profile | null;
  if (!profile?.organization_id) {
    return NextResponse.redirect(`${base}?google=error&reason=no_org`);
  }

  // Guardar tokens cifrados
  const service = createServiceClient();
  const { error: upsertError } = await service
    .from("google_calendar_configs")
    .upsert(
      {
        organization_id: profile.organization_id,
        calendar_id: "primary",
        refresh_token_encrypted: encrypt(tokens.refresh_token),
        access_token_encrypted: encrypt(tokens.access_token),
        token_expires_at: new Date(
          Date.now() + tokens.expires_in * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );

  if (upsertError) {
    return NextResponse.redirect(`${base}?google=error&reason=db`);
  }

  return NextResponse.redirect(`${base}?google=connected`);
}
