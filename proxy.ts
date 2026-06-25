import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export default async function proxy(request: NextRequest) {
  // supabaseResponse se actualiza dentro de setAll para propagar cookies al browser
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Primero inyectamos en el request para que los Server Components lo lean
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          // Luego en la respuesta para que el browser persista el token refrescado
          // DECISION: any necesario — CookieOptions de @supabase/ssr y
          // Partial<ResponseCookie> de Next.js son compatibles en runtime pero
          // difieren en el tipo de sameSite (boolean vs string literal)
          cookiesToSet.forEach(({ name, value, options }) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabaseResponse.cookies.set(name, value, options as any)
          );
        },
      },
    }
  );

  // getUser() verifica el JWT contra Supabase Auth (no confiar en getSession() server-side)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isAppRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/citas") ||
    pathname.startsWith("/conversaciones") ||
    pathname.startsWith("/personalizacion") ||
    pathname.startsWith("/integraciones");

  const isAuthRoute =
    pathname.startsWith("/login") || pathname.startsWith("/signup");

  if (isAppRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Excluir assets estáticos y rutas de API (webhook de WhatsApp no debe interceptarse)
    "/((?!_next/static|_next/image|favicon\\.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
