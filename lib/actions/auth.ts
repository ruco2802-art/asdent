"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import type { Json } from "@/lib/database.types";

export type AuthState = {
  error?: string;
  success?: boolean;
  message?: string;
};

// ---- Helpers ----

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  // Sufijo aleatorio para evitar colisiones de slug único
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildDefaultSystemPrompt(businessName: string): string {
  return (
    `Eres el asistente virtual de ${businessName}, una clínica dental. ` +
    `Tu función es agendar citas de forma eficiente y empática.\n` +
    `Tono: profesional y cálido.\n\n` +
    `Cuando el paciente mencione dolor, urgencia o emergencia dental, ` +
    `prioriza buscar el slot más próximo disponible (mismo día si es posible).`
  );
}

function defaultBusinessHours(): Json {
  return {
    mon: [{ start: "08:00", end: "18:00" }],
    tue: [{ start: "08:00", end: "18:00" }],
    wed: [{ start: "08:00", end: "18:00" }],
    thu: [{ start: "08:00", end: "18:00" }],
    fri: [{ start: "08:00", end: "17:00" }],
    sat: [{ start: "09:00", end: "13:00" }],
    sun: [],
  };
}

// ---- Actions ----

export async function signUpAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get("email") as string).trim();
  const password = formData.get("password") as string;
  const fullName = (formData.get("fullName") as string).trim();
  const businessName = (formData.get("businessName") as string).trim();

  if (!email || !password || !fullName || !businessName) {
    return { error: "Todos los campos son obligatorios." };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = await createClient();

  const { data, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/callback`,
    },
  });

  if (authError) return { error: authError.message };
  if (!data.user) return { error: "No se pudo crear el usuario." };

  // Usamos service client para crear org y actualizar profile (bypassa RLS,
  // necesario porque el usuario recién creado aún no tiene sesión establecida)
  const service = createServiceClient();

  const { data: org, error: orgError } = await service
    .from("organizations")
    .insert({ name: businessName, slug: generateSlug(businessName) })
    .select("id")
    .single();

  if (orgError) {
    return { error: "No se pudo crear la organización. Intenta de nuevo." };
  }

  // Upsert por si el trigger de BD aún no creó el profile (race condition teórica)
  await Promise.all([
    service.from("profiles").upsert({
      id: data.user.id,
      organization_id: org.id,
      full_name: fullName,
    }),
    service.from("agent_configs").insert({
      organization_id: org.id,
      system_prompt: buildDefaultSystemPrompt(businessName),
      business_info: { name: businessName } as Json,
      business_hours: defaultBusinessHours(),
    }),
  ]);

  // Sin sesión = confirmación de email requerida
  if (!data.session) {
    return {
      success: true,
      message: "Revisa tu correo electrónico para confirmar tu cuenta.",
    };
  }

  redirect("/dashboard");
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get("email") as string).trim();
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: "Correo o contraseña incorrectos." };

  redirect("/dashboard");
}

export async function sendMagicLinkAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = (formData.get("email") as string).trim();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/callback`,
    },
  });

  if (error) return { error: error.message };

  return {
    success: true,
    message: "Te enviamos un enlace mágico. Revisa tu correo.",
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
