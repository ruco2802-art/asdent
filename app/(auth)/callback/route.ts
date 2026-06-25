import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// Maneja el callback de Supabase Auth:
// - Magic links (OTP)
// - Confirmación de email (signup)
// - OAuth flows futuros (Google Calendar se gestiona en /api/auth/google/callback)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Redirigir con URL absoluta para que el proxy refresque la cookie
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
