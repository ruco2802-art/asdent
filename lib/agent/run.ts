import { generateText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { createAgentTools, type AgentContext } from "@/lib/agent/tools";
import type { AgentConfig, Organization, Json } from "@/lib/database.types";

// Day names for human-readable business hours in system prompt
const DAY_NAMES: Record<string, string> = {
  mon: "Lunes", tue: "Martes", wed: "Miércoles",
  thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo",
};

const FALLBACK_SYSTEM_PROMPT =
  "Eres el asistente virtual de una clínica dental. Tu función es agendar citas de forma eficiente y empática. Responde siempre en español.";

const FALLBACK_ERROR_MESSAGE =
  "Disculpa, tuve un problema técnico procesando tu mensaje. Un miembro de nuestro equipo te contactará en breve 🙏";
const FALLBACK_EMPTY_MESSAGE =
  "Disculpa, ¿podrías repetir tu mensaje? No logré procesar bien tu solicitud.";

function buildSystemPrompt(
  config: AgentConfig | null,
  bookingState: string | null,
  bookingData: Json | null,
  timezone: string
): string {
  const base = config?.system_prompt ?? FALLBACK_SYSTEM_PROMPT;

  const todayStr = new Intl.DateTimeFormat("es-CO", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const services = (config?.services ?? []) as {
    name: string;
    duration_minutes?: number;
    description?: string;
  }[];
  const servicesText =
    services.length > 0
      ? services
          .map(
            (s) =>
              `- ${s.name}${s.duration_minutes ? ` (${s.duration_minutes} min)` : ""}${
                s.description ? `: ${s.description}` : ""
              }`
          )
          .join("\n")
      : "Sin servicios configurados — usa las duraciones por defecto del sector dental.";

  const hours = (config?.business_hours ?? {}) as Record<
    string,
    { start: string; end: string }[]
  >;
  const hoursText =
    Object.keys(hours).length > 0
      ? Object.entries(hours)
          .map(
            ([d, ps]) =>
              `${DAY_NAMES[d] ?? d}: ${ps.map((p) => `${p.start}–${p.end}`).join(", ")}`
          )
          .join("\n")
      : "Horarios no configurados — consultar disponibilidad con el equipo.";

  const stateText = bookingState ?? "sin iniciar";
  const dataText = JSON.stringify(bookingData ?? {});

  return `${base}

---
FECHA Y HORA ACTUAL: ${todayStr} (zona horaria ${timezone})
Usa esta fecha como referencia absoluta para calcular "hoy", "mañana", "el próximo lunes", etc. Nunca calcules ni asumas la fecha de memoria.

SERVICIOS DISPONIBLES:
${servicesText}

HORARIOS DE ATENCIÓN:
${hoursText}

ESTADO ACTUAL DE ESTA CONVERSACIÓN:
Etapa de agendamiento: ${stateText}
Datos recolectados hasta ahora: ${dataText}

REGLAS QUE DEBES SEGUIR SIN EXCEPCIÓN:
1. Si el paciente menciona dolor, urgencia o emergencia dental, responde con empatía y usa get_available_slots con is_urgent: true.
2. Recolecta los datos en orden: servicio → ¿es nuevo paciente? → nombre completo → slot → datos clínicos si aplica → confirmación explícita.
3. Nunca muestres fechas en formato ISO al paciente. Usa siempre el campo "label" que devuelve get_available_slots — no calcules tú el día de la semana.
4. Nunca inventes slots. Llama a get_available_slots y ofrece solo los que devuelva. Si el paciente rechaza los slots ofrecidos y pide "otro día" sin especificar, vuelve a llamar la tool aumentando skip_days. Si el paciente menciona una fecha exacta ("el viernes 10 de julio"), usa preferred_date con esa fecha en vez de skip_days.
5. Cuando el paciente elija uno de los horarios que ya le mostraste, usa exactamente ese "iso" para book_appointment — no vuelvas a llamar get_available_slots para "verificar" un slot que tú mismo ya ofreciste en esta conversación.
6. Confirma TODOS los datos explícitamente con el paciente antes de llamar a book_appointment.
7. Si no puedes resolver algo o el paciente lo solicita, llama a request_human_handoff.
8. Nunca preguntes el teléfono — se obtiene automáticamente de WhatsApp.
9. Si booking_state es 'done', no inicies un nuevo flujo salvo que el paciente lo pida.
10. Si el paciente envía una imagen (radiografía, foto dental, documento), analízala en contexto médico-dental.`;
}

// Local message type: string content for text messages, array content for images.
// Both are structural subtypes of ModelMessage (UserModelMessage | AssistantModelMessage).
type ImagePart = { type: "image"; image: string; mimeType: string };
type TextPart = { type: "text"; text: string };
type Msg =
  | { role: "user"; content: string }
  | { role: "user"; content: Array<ImagePart | TextPart> }
  | { role: "assistant"; content: string };

// Reads up to 20 previous messages, skipping null-content entries.
// Merges consecutive same-direction messages (WhatsApp allows multiple quick messages).
async function fetchMessageHistory(
  conversationId: string,
  db: ReturnType<typeof createServiceClient>
): Promise<Array<{ role: "user"; content: string } | { role: "assistant"; content: string }>> {
  // Fetch the most recent 20 (descending), then reverse to chronological
  // order. Ordering ascending+limit(20) would instead return the OLDEST 20
  // messages, permanently excluding the newest ones (including the message
  // that just triggered this run) once a conversation passes 20 messages.
  const { data } = await db
    .from("messages")
    .select("direction, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data?.length) return [];

  const rows = (
    data as { direction: string; content: string | null }[]
  ).reverse();
  const messages: Array<{ role: "user"; content: string } | { role: "assistant"; content: string }> = [];

  for (const row of rows) {
    if (!row.content) continue;
    const role: "user" | "assistant" =
      row.direction === "inbound" ? "user" : "assistant";

    const last = messages[messages.length - 1];
    if (last?.role === role) {
      last.content = `${last.content}\n${row.content}`;
    } else {
      messages.push({ role, content: row.content });
    }
  }

  return messages;
}

export interface ImageAttachment {
  base64: string;
  mimeType: string;
  caption?: string; // text sent alongside the image (WhatsApp caption field)
}

interface RunAgentParams extends AgentContext {
  bookingState: string | null;
  bookingData: Json | null;
  imageAttachment?: ImageAttachment;
}

export async function runAgent(params: RunAgentParams): Promise<void> {
  const {
    organizationId, contactId, conversationId, waPhone,
    bookingState, bookingData, imageAttachment,
  } = params;

  const db = createServiceClient();

  const { data: rawConfig } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .maybeSingle() con tipos manuales
  const config = rawConfig as AgentConfig | null;

  const { data: rawOrg } = await db
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();
  // DECISION: mismo patrón de cast
  const org = rawOrg as Organization | null;
  const timezone = org?.timezone ?? "America/Bogota";

  const systemPrompt = buildSystemPrompt(config, bookingState, bookingData, timezone);
  const history = await fetchMessageHistory(conversationId, db);

  // Build the messages array, injecting image into the last user turn if present
  const messages: Msg[] = [...history];

  if (imageAttachment) {
    const imageParts: Array<ImagePart | TextPart> = [
      { type: "image", image: imageAttachment.base64, mimeType: imageAttachment.mimeType },
    ];
    if (imageAttachment.caption) {
      imageParts.push({ type: "text", text: imageAttachment.caption });
    }

    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      // Replace the text-only version (caption stored in DB) with the full image+caption
      messages[messages.length - 1] = { role: "user", content: imageParts };
    } else {
      // Pure image with no caption — the DB entry was null-content and got filtered out
      messages.push({ role: "user", content: imageParts });
    }
  }

  if (messages.length === 0) {
    console.warn(
      JSON.stringify({ event: "agent_no_messages", conversation_id: conversationId })
    );
    return;
  }

  // Claude's API rejects a conversation that doesn't end on a user turn.
  // This should be structurally impossible now (the just-inserted inbound
  // message is always the newest row), but if it ever happens again, skip
  // straight to the fallback instead of burning an API call guaranteed to
  // error out with "must end with a user message".
  const historyEndsInUser = messages[messages.length - 1].role === "user";
  if (!historyEndsInUser) {
    console.error(
      JSON.stringify({
        event: "agent_history_not_ending_in_user",
        conversation_id: conversationId,
      })
    );
  }

  const agentCtx: AgentContext = { organizationId, contactId, conversationId, waPhone };

  let resultText: string;
  if (!historyEndsInUser) {
    resultText = FALLBACK_EMPTY_MESSAGE;
  } else {
    try {
      const result = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        system: systemPrompt,
        // DECISION: cast necesario — Msg es estructuralmente compatible con ModelMessage
        // pero TS no puede inferirlo por la unión discriminada de UserModelMessage.content
        messages: messages as unknown as ModelMessage[],
        tools: createAgentTools(agentCtx),
        stopWhen: stepCountIs(10),
        temperature: 0.3,
      });
      resultText = result.text;
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "agent_error",
          conversation_id: conversationId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      resultText = FALLBACK_ERROR_MESSAGE;
    }
  }

  if (!resultText) resultText = FALLBACK_EMPTY_MESSAGE;

  // request_human_handoff sets bot_active=false and sends its own message.
  // Re-check DB to avoid sending a duplicate response in that case.
  const { data: updatedConv } = await db
    .from("conversations")
    .select("bot_active")
    .eq("id", conversationId)
    .maybeSingle();
  // DECISION: cast necesario — supabase-js@2.49.9 infiere never
  const stillActive =
    (updatedConv as { bot_active: boolean | null } | null)?.bot_active ?? false;

  if (!stillActive) return;

  let wamid: string;
  try {
    wamid = await sendWhatsAppMessage(organizationId, waPhone, resultText);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "agent_send_error",
        conversation_id: conversationId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return;
  }

  await db.from("messages").insert({
    conversation_id: conversationId,
    organization_id: organizationId,
    wa_message_id: wamid,
    direction: "outbound",
    sender: "bot",
    content: resultText,
    created_at: new Date().toISOString(),
  });

  console.log(
    JSON.stringify({
      event: "agent_responded",
      conversation_id: conversationId,
      wamid,
      chars: resultText.length,
    })
  );
}
