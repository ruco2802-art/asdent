import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { AgentConfig } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SandboxRequest {
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  systemPrompt?: string; // allow testing unsaved prompt
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: SandboxRequest;
  try {
    body = (await req.json()) as SandboxRequest;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { message, history = [], systemPrompt: promptOverride } = body;
  if (!message?.trim()) {
    return Response.json({ error: "Mensaje vacío" }, { status: 400 });
  }

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .single() con tipos manuales
  const orgId = (rawProfile as { organization_id: string | null } | null)
    ?.organization_id;
  if (!orgId) {
    return Response.json({ error: "Sin organización" }, { status: 400 });
  }

  // Use override prompt (testing unsaved config) or fallback to saved DB config
  let systemPrompt = promptOverride?.trim() ?? "";
  if (!systemPrompt) {
    const { data: rawConfig } = await supabase
      .from("agent_configs")
      .select("system_prompt, services, business_hours")
      .eq("organization_id", orgId)
      .maybeSingle();
    // DECISION: cast necesario — mismo patrón
    const config = rawConfig as Pick<
      AgentConfig,
      "system_prompt" | "services" | "business_hours"
    > | null;
    systemPrompt =
      config?.system_prompt ??
      "Eres el asistente virtual de una clínica dental. Responde siempre en español.";
  }

  const messages = [
    ...history,
    { role: "user" as const, content: message.trim() },
  ];

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      system: `${systemPrompt}\n\n[MODO SANDBOX: No hay citas reales. Responde como si fuera una conversación real de WhatsApp pero no llames herramientas.]`,
      messages,
      temperature: 0.3,
    });
    return Response.json({ response: result.text });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "sandbox_error",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return Response.json({ error: "Error del modelo IA" }, { status: 500 });
  }
}
