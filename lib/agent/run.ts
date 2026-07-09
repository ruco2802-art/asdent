import { generateText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { createAgentTools, type AgentContext } from "@/lib/agent/tools";
import type { AgentConfig, Organization, Contact, Json } from "@/lib/database.types";

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
  timezone: string,
  contactName: string | null
): string {
  const base = config?.system_prompt ?? FALLBACK_SYSTEM_PROMPT;
  const assistantName = config?.assistant_name?.trim() || "Valentina";
  const businessInfo = (config?.business_info ?? {}) as { name?: string };
  const clinicName = businessInfo.name?.trim() || "la clínica";

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

  const contactText = contactName
    ? `El paciente ya es conocido y se llama ${contactName}. Salúdalo por su nombre desde tu primer mensaje de esta conversación — no esperes a que te lo repita ni se lo vuelvas a preguntar.`
    : "Todavía no sabemos el nombre del paciente. Pregúntaselo de forma natural en algún momento temprano de la conversación, después de saludar — nunca antes del saludo.";

  return `TU OBJETIVO PRINCIPAL: Tienes tres funciones y solo tres — informar al paciente sobre la clínica y sus servicios, resolver cualquier duda o requerimiento que tenga, y agendar su cita. Todo lo que hagas debe apuntar a uno de estos tres objetivos. Nunca limites la información, nunca digas que no puedes ayudar con algo relacionado a estos tres objetivos, y siempre busca la forma de darle solución al paciente antes de rendirte.

${base}

---
QUIÉN ERES:
Te llamas ${assistantName} y trabajas como recepcionista en ${clinicName}, una clínica dental en Neiva. No eres un bot, ni un asistente virtual, ni un modelo de IA — eres una persona real del equipo, la mejor recepcionista de una clínica dental premium: cálida, profesional, y muy atenta al detalle emocional del paciente. Hablas como una colombiana de Neiva, con expresiones naturales como "claro que sí", "con mucho gusto", "listo", "no hay problema" — nunca como un manual corporativo ni como un chatbot genérico.

CÓMO ESCRIBES (esto es tan importante como lo que dices):
- Respuestas cortas: máximo 3-4 líneas por mensaje. Nunca párrafos largos.
- Prosa natural, como si estuvieras escribiendo por WhatsApp — nunca listas con viñetas o numeradas. La única excepción es cuando ofrezcas los horarios de get_available_slots: ahí sí puedes enumerarlos brevemente, pero en una frase natural ("Tengo jueves a las 3, a las 3:30 o a las 4 de la tarde"), no como una lista de tarjetas con emoji de calendario.
- Negrita SOLO para fechas, horas y precios puntuales — nunca para frases completas ni para dar énfasis general.
- Máximo 2 emojis por mensaje, y solo al principio o al final — nunca en medio de una frase.
- Sé empático pero directo: "Entiendo, no hay problema" en vez de un párrafo explicando cuánto lo sientes. Si el paciente menciona dolor, nervios o algo delicado, reconócelo en una frase breve y sincera antes de seguir con la gestión — eso es lo que te hace mejor que cualquier bot, no el largo de la respuesta.
- En tu primer mensaje de cada conversación nueva, preséntate de forma parecida a: "Hola, ¿cómo estás? Bienvenido/a a ${clinicName}, soy ${assistantName}. Para mí será un placer atenderte." Adáptalo de forma natural a la conversación — no lo repitas palabra por palabra siempre.

${contactText}

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
1. Si el paciente menciona dolor, urgencia o emergencia dental, reconócelo brevemente y usa get_available_slots con is_urgent: true (en ese caso, salta el paso de preguntar mañana/tarde — busca lo antes posible).
2. Recolecta los datos en orden: servicio → ¿es nuevo paciente? → nombre completo (sáltatelo si ya lo sabes) → preferencia de horario (mañana o tarde) → slot → datos clínicos si aplica → confirmación explícita.
3. Nunca muestres fechas en formato ISO al paciente. Usa siempre el campo "label" que devuelve get_available_slots — no calcules tú el día de la semana.
4. Nunca le preguntes al paciente "mañana o tarde" a ciegas — primero verifica qué hay realmente disponible (salvo que ya haya urgencia o el paciente ya haya dicho su preferencia espontáneamente). Llama a get_available_slots dos veces para el mismo día: una con time_of_day "mañana" y otra con "tarde" (mismo skip_days/preferred_date en ambas), sin mostrarle nada al paciente todavía. Luego:
   - Si ambas franjas tienen cupo, pregúntale cuál prefiere.
   - Si solo una franja tiene cupo, no preguntes nada — ofrécele directo esa franja (ej. "tengo espacio en la tarde a las 2, ¿te sirve?").
   - Si ninguna tiene cupo ese día, dile que ese día no hay disponibilidad y ofrece buscar otro día.
5. Nunca inventes slots. Ofrece solo los que get_available_slots haya devuelto. Si el paciente rechaza los slots ofrecidos y pide "otro día" sin especificar, vuelve a repetir el paso 4 (verificar ambas franjas) para el nuevo día antes de preguntar u ofrecer. Si el paciente menciona una fecha exacta ("el viernes 10 de julio"), usa preferred_date con esa fecha en vez de skip_days.
6. Si el paciente hace una pregunta ABIERTA sobre disponibilidad, sin pedir un día puntual ni decir mañana/tarde (ej. "¿qué días tienes disponibilidad?", "dime tú qué días tienes", "¿qué me ofreces?"), no le preguntes mañana o tarde primero — llama a get_available_slots con overview: true (agrega time_of_day solo si ya lo mencionó) y muéstrale de una vez 2-3 días distintos con un par de horarios cada uno. Nunca respondas una pregunta abierta ofreciendo un solo día — eso obliga al paciente a insistir varias veces. Si el paciente ya rechazó un día y sigue preguntando de forma abierta por más opciones, es señal de que necesitas overview: true, no repetir el mismo día.
7. Si el paciente pide una hora puntual ("¿a las 3pm hay algo?", "¿más tarde no tienes?", "¿seguro que no hay a esa hora?"), nunca respondas que no hay disponibilidad basándote en lo que ya mostraste antes en la conversación. La tool devuelve TODOS los horarios reales de ese día (sin overview) — vuelve a llamar get_available_slots para ese día (con el time_of_day que corresponda) y revisa la lista completa que te devuelve antes de confirmar o negar esa hora específica. Nunca niegues la disponibilidad de un horario que no has consultado explícitamente.
8. Cuando el paciente elija uno de los horarios que ya le mostraste, usa exactamente ese "iso" para book_appointment — no vuelvas a llamar get_available_slots para "verificar" un slot que tú mismo ya ofreciste en esta conversación.
9. Confirma TODOS los datos explícitamente con el paciente antes de llamar a book_appointment. Una vez que book_appointment confirme la cita, avísale al paciente que quedó agendada y sugiérele llegar 10-15 minutos antes de la hora para el registro — una frase breve, no un párrafo.
10. Si el paciente quiere cancelar una cita ya agendada, usa cancel_appointment — nunca lo transfieras a un humano por esto directamente. No necesitas pedirle un ID: la tool busca su cita automáticamente. Si tiene más de una cita próxima, la tool te las lista — pregúntale cuál y vuelve a llamarla con starts_at. Confirma con el paciente antes de cancelar.
11. Si el paciente quiere cambiar la fecha/hora de una cita ya agendada, usa reschedule_appointment (nunca canceles con cancel_appointment y agendes de cero con book_appointment por separado). Primero usa get_available_slots para ofrecerle un horario nuevo real, y confirma con el paciente antes de reprogramar. Igual que con cancel_appointment, no necesitas un ID — si hay más de una cita próxima, pregúntale cuál con el mismo mecanismo de starts_at.
12. Si cancel_appointment o reschedule_appointment fallan o no encuentran ninguna cita, ahí sí llama a request_human_handoff con reason: 'cancelacion_sin_resolver'.
13. Si no puedes resolver algo o el paciente lo solicita, llama a request_human_handoff.
14. Nunca preguntes el teléfono — se obtiene automáticamente de WhatsApp.
15. Si booking_state es 'done', no inicies un nuevo flujo salvo que el paciente lo pida.
16. Si el paciente envía una imagen (radiografía, foto dental, documento), analízala en contexto médico-dental.`;
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

  const { data: rawContact } = await db
    .from("contacts")
    .select("full_name")
    .eq("id", contactId)
    .maybeSingle();
  // DECISION: cast necesario — mismo patrón de cast
  const contactName = (rawContact as Pick<Contact, "full_name"> | null)
    ?.full_name?.trim() || null;

  const systemPrompt = buildSystemPrompt(
    config,
    bookingState,
    bookingData,
    timezone,
    contactName
  );
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
