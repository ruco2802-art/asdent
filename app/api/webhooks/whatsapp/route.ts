import { createHmac, timingSafeEqual } from "crypto";
import { after } from "next/server";
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decrypt } from "@/lib/crypto";
import { runAgent, type ImageAttachment } from "@/lib/agent/run";
import { downloadMetaMedia } from "@/lib/media/download";
import { transcribeAudio } from "@/lib/media/transcribe";
import { extractPdfText } from "@/lib/media/extract-pdf";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import type { WhatsappConfig, Json } from "@/lib/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How long last_message_at must stay unchanged before we consider the
// conversation "quiet" and let the agent process the accumulated messages.
const DEBOUNCE_MS = 2500;
// How often to re-poll last_message_at while waiting for quiet.
const POLL_INTERVAL_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls last_message_at until it hasn't changed for a full DEBOUNCE_MS
// window, then returns that final value. A fixed single sleep-then-compare
// isn't enough: if one message's pipeline (webhook receipt -> DB write) is
// slower than another's, both invocations can independently observe "nothing
// changed since I checked" and both think they're the leader. Polling for
// genuine quiescence converges every concurrent invocation on the same final
// last_message_at value, so only the one whose own write matches it proceeds.
async function waitForQuiet(
  conversationId: string,
  db: ReturnType<typeof createServiceClient>
): Promise<string | null> {
  let lastSeen: string | null = null;
  let stableSince = Date.now();

  for (;;) {
    const { data } = await db
      .from("conversations")
      .select("last_message_at")
      .eq("id", conversationId)
      .maybeSingle();
    const current =
      (data as { last_message_at: string | null } | null)?.last_message_at ??
      null;

    if (
      lastSeen === null ||
      (current && new Date(current).getTime() !== new Date(lastSeen).getTime())
    ) {
      lastSeen = current;
      stableSince = Date.now();
    }

    if (Date.now() - stableSince >= DEBOUNCE_MS) {
      return lastSeen;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ─── WhatsApp Cloud API v25.0 payload types ────────────────────────────────────

interface WaMessage {
  id: string;
  from: string; // wa_id sin '+', ej. "573001234567"
  timestamp: string; // Unix seconds como string
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type: string };
  audio?: { id: string; mime_type: string };
  voice?: { id: string; mime_type: string }; // notas de voz grabadas en WhatsApp
  document?: { id: string; filename?: string; caption?: string; mime_type: string };
}

interface WaContact {
  profile: { name: string };
  wa_id: string;
}

interface WaValue {
  messaging_product: "whatsapp";
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: WaContact[];
  messages?: WaMessage[];
  statuses?: unknown[];
}

interface WaPayload {
  object: string;
  entry: { id: string; changes: { value: WaValue; field: string }[] }[];
}

// ─── HMAC-SHA256 verification (constant-time) ─────────────────────────────────

function verifySignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signature.startsWith("sha256=") ? signature.slice(7) : "";
  if (received.length !== 64) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex")
  );
}

// ─── GET — Verificación del webhook ───────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return new Response("Bad Request", { status: 400 });
  }

  // 1. Check env var fallback first — useful before any org has configured WhatsApp
  const envToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (envToken && token === envToken) {
    console.log(JSON.stringify({ event: "webhook_verified", source: "env_token" }));
    return new Response(challenge, { status: 200 });
  }

  // 2. Fall back to per-organization token stored in DB
  const service = createServiceClient();
  const { data: raw } = await service
    .from("whatsapp_configs")
    .select("organization_id")
    .eq("verify_token", token)
    .maybeSingle();

  if (!raw) {
    console.warn(
      JSON.stringify({ event: "webhook_verify_failed", verify_token: token })
    );
    return new Response("Forbidden", { status: 403 });
  }

  const { organization_id } = raw as { organization_id: string };
  console.log(JSON.stringify({ event: "webhook_verified", source: "db", organization_id }));
  return new Response(challenge, { status: 200 });
}

// ─── POST — Recepción de mensajes ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";

  let payload: WaPayload;
  try {
    payload = JSON.parse(rawBody) as WaPayload;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (payload.object !== "whatsapp_business_account") {
    return new Response("OK", { status: 200 });
  }

  const phoneNumberId =
    payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) {
    return new Response("OK", { status: 200 });
  }

  const service = createServiceClient();
  const { data: rawConfig } = await service
    .from("whatsapp_configs")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  if (!rawConfig) {
    console.warn(
      JSON.stringify({ event: "unknown_phone_number_id", phone_number_id: phoneNumberId })
    );
    return new Response("OK", { status: 200 });
  }

  const config = rawConfig as WhatsappConfig;

  let appSecret: string;
  try {
    appSecret = decrypt(config.app_secret_encrypted);
  } catch {
    console.error(
      JSON.stringify({ event: "decrypt_error", organization_id: config.organization_id })
    );
    return new Response("OK", { status: 200 });
  }

  if (!verifySignature(rawBody, signature, appSecret)) {
    console.warn(
      JSON.stringify({ event: "signature_invalid", organization_id: config.organization_id })
    );
    return new Response("Forbidden", { status: 403 });
  }

  // Decrypt access token here (once) to avoid duplicate DB+crypto work per message
  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token_encrypted);
  } catch {
    console.error(
      JSON.stringify({ event: "token_decrypt_error", organization_id: config.organization_id })
    );
    return new Response("OK", { status: 200 });
  }

  // Respond 200 immediately — Meta requires a response within seconds
  after(async () => {
    try {
      await processEntries(payload, config.organization_id, accessToken, startTime);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "processing_error",
          organization_id: config.organization_id,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });

  return new Response("OK", { status: 200 });
}

// ─── Background processing ─────────────────────────────────────────────────────

async function processEntries(
  payload: WaPayload,
  organizationId: string,
  accessToken: string,
  startTime: number
) {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const { messages, contacts } = change.value;
      if (!messages?.length) continue;

      for (const message of messages) {
        await processInboundMessage(
          message,
          contacts ?? [],
          organizationId,
          accessToken,
          startTime
        );
      }
    }
  }
}

// ─── Media processing helpers ─────────────────────────────────────────────────

const FALLBACK_MESSAGES = {
  image:
    "No pude procesar la imagen que enviaste 😔. ¿Podrías reenviarla o describir con palabras qué necesitas?",
  audio:
    "No pude transcribir tu mensaje de voz 😔. ¿Podrías escribir lo que necesitas?",
  document:
    "No pude leer el documento que enviaste 😔. ¿Podrías enviar la información en texto o reenviar el archivo?",
};

async function sendFallback(
  organizationId: string,
  conversationId: string,
  waPhone: string,
  type: keyof typeof FALLBACK_MESSAGES,
  db: ReturnType<typeof createServiceClient>
): Promise<void> {
  const text = FALLBACK_MESSAGES[type];
  try {
    const wamid = await sendWhatsAppMessage(organizationId, waPhone, text);
    await db.from("messages").insert({
      conversation_id: conversationId,
      organization_id: organizationId,
      wa_message_id: wamid,
      direction: "outbound",
      sender: "bot",
      content: text,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort — don't throw
  }
}

// ─── Inbound message processing ───────────────────────────────────────────────

async function processInboundMessage(
  message: WaMessage,
  contacts: WaContact[],
  organizationId: string,
  accessToken: string,
  startTime: number
) {
  const db = createServiceClient();
  const waPhone = `+${message.from}`;
  const waMessageId = message.id;
  const waContact = contacts.find((c) => c.wa_id === message.from);
  const contactName = waContact?.profile.name ?? null;

  // 1. Upsert contact
  const { data: rawContact, error: contactError } = await db
    .from("contacts")
    .upsert(
      {
        organization_id: organizationId,
        wa_phone: waPhone,
        ...(contactName ? { full_name: contactName } : {}),
      },
      { onConflict: "organization_id,wa_phone" }
    )
    .select("id")
    .single();

  if (contactError || !rawContact) {
    console.error(
      JSON.stringify({
        event: "contact_upsert_error",
        organization_id: organizationId,
        wa_phone: waPhone,
        error: contactError?.message,
      })
    );
    return;
  }

  const contactId = (rawContact as { id: string }).id;

  // 2. Find or create conversation
  const { data: rawExisting } = await db
    .from("conversations")
    .select("id, bot_active, booking_state, booking_data")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  let botActive = true;
  let bookingState: string | null = null;
  let bookingData: Json = {};

  // Single timestamp for this message, written to last_message_at and later
  // compared against the same column to detect whether a newer message
  // arrived while this invocation was debouncing (see step 5).
  const myTimestamp = new Date().toISOString();

  if (rawExisting) {
    const conv = rawExisting as {
      id: string;
      bot_active: boolean | null;
      booking_state: string | null;
      booking_data: Json | null;
    };
    conversationId = conv.id;
    botActive = conv.bot_active ?? true;
    bookingState = conv.booking_state;
    bookingData = conv.booking_data ?? {};

    await db
      .from("conversations")
      .update({ last_message_at: myTimestamp })
      .eq("id", conversationId);
  } else {
    const { data: rawNew, error: convError } = await db
      .from("conversations")
      .insert({
        organization_id: organizationId,
        contact_id: contactId,
        bot_active: true,
        last_message_at: myTimestamp,
      })
      .select("id")
      .single();

    if (convError || !rawNew) {
      console.error(
        JSON.stringify({
          event: "conversation_insert_error",
          organization_id: organizationId,
          contact_id: contactId,
          error: convError?.message,
        })
      );
      return;
    }

    conversationId = (rawNew as { id: string }).id;
  }

  // 2.5. Si el paciente tiene una cita esperando confirmación, cualquier
  // respuesta suya cuenta como "sigue ahí" y la marca confirmada — saca la
  // cita del ciclo de reintentos del cron. Si en realidad quiere cancelar o
  // reprogramar, cancel_appointment/reschedule_appointment sobreescriben
  // este estado en el mismo turno.
  const { data: awaitingAppts } = await db
    .from("appointments")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("confirmation_status", "awaiting_confirmation");

  if (awaitingAppts && awaitingAppts.length > 0) {
    await db
      .from("appointments")
      .update({ confirmation_status: "confirmed" })
      .in(
        "id",
        (awaitingAppts as { id: string }[]).map((a) => a.id)
      );
  }

  // 3. Resolve content and media attachment from message type
  let content: string | null = null;
  let rawField: Json = message as unknown as Json;
  let imageAttachment: ImageAttachment | undefined;

  const msgType = message.type;

  if (msgType === "text") {
    content = message.text?.body ?? null;
  } else if (msgType === "image" && message.image) {
    const { id: mediaId, caption, mime_type: mimeType } = message.image;
    content = caption ?? null; // caption stored as text; image bytes go via attachment
    rawField = { type: "image", media_id: mediaId, mime_type: mimeType, caption } as unknown as Json;

    if (botActive) {
      try {
        const { buffer, mimeType: actualMime } = await downloadMetaMedia(mediaId, accessToken);
        imageAttachment = {
          base64: buffer.toString("base64"),
          mimeType: actualMime,
          caption: caption ?? undefined,
        };
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "image_download_error",
            conversation_id: conversationId,
            error: err instanceof Error ? err.message : String(err),
          })
        );
        // Store message with null content then send fallback — don't run agent
        await insertMessage(db, conversationId, organizationId, waMessageId, content, rawField);
        await sendFallback(organizationId, conversationId, waPhone, "image", db);
        return;
      }
    }
  } else if ((msgType === "audio" || msgType === "voice") && (message.audio ?? message.voice)) {
    const media = message.audio ?? message.voice!;
    rawField = { type: msgType, media_id: media.id, mime_type: media.mime_type } as unknown as Json;

    if (botActive) {
      try {
        const { buffer, mimeType } = await downloadMetaMedia(media.id, accessToken);
        const transcription = await transcribeAudio(buffer, mimeType);
        content = `[Mensaje de voz transcrito]: ${transcription}`;
        (rawField as Record<string, unknown>).transcription = transcription;
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "audio_transcribe_error",
            conversation_id: conversationId,
            error: err instanceof Error ? err.message : String(err),
          })
        );
        await insertMessage(db, conversationId, organizationId, waMessageId, null, rawField);
        await sendFallback(organizationId, conversationId, waPhone, "audio", db);
        return;
      }
    }
  } else if (
    msgType === "document" &&
    message.document?.mime_type === "application/pdf"
  ) {
    const { id: mediaId, caption, filename } = message.document;
    rawField = { type: "document", media_id: mediaId, filename, caption, mime_type: "application/pdf" } as unknown as Json;

    if (botActive) {
      try {
        const { buffer } = await downloadMetaMedia(mediaId, accessToken);
        const extracted = await extractPdfText(buffer);
        content = `[Documento adjunto${filename ? ` — ${filename}` : ""}]: ${extracted}`;
        if (caption) content = `${caption}\n${content}`;
        (rawField as Record<string, unknown>).extracted_chars = extracted.length;
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "pdf_extract_error",
            conversation_id: conversationId,
            error: err instanceof Error ? err.message : String(err),
          })
        );
        await insertMessage(db, conversationId, organizationId, waMessageId, null, rawField);
        await sendFallback(organizationId, conversationId, waPhone, "document", db);
        return;
      }
    }
  }

  // 4. Insert message (idempotent via unique index on wa_message_id)
  const insertErr = await insertMessage(db, conversationId, organizationId, waMessageId, content, rawField);
  if (insertErr === "duplicate") return; // already processed
  if (insertErr === "error") return;

  // 5. Log + invoke agent
  console.log(
    JSON.stringify({
      event: "message_stored",
      wa_message_id: waMessageId,
      organization_id: organizationId,
      conversation_id: conversationId,
      contact_id: contactId,
      msg_type: msgType,
      bot_active: botActive,
      booking_state: bookingState,
      latency_ms: Date.now() - startTime,
    })
  );

  const hasContent = !!content || !!imageAttachment;
  if (botActive && hasContent) {
    // Debounce: wait until last_message_at has been quiet for DEBOUNCE_MS so
    // rapid consecutive messages from the same patient get batched into a
    // single agent turn instead of racing each other. Every concurrent
    // invocation converges on the same final last_message_at value; only the
    // one whose own write matches it is the leader and proceeds.
    const finalTimestamp = await waitForQuiet(conversationId, db);

    // Compare as epoch ms, not raw strings — Postgres/Supabase returns
    // timestamptz as "...+00:00" while Date#toISOString() produces "...Z".
    // Same instant, different string, so a naive !== always mismatched.
    if (
      !finalTimestamp ||
      new Date(finalTimestamp).getTime() !== new Date(myTimestamp).getTime()
    ) {
      console.log(
        JSON.stringify({
          event: "debounced_skip",
          conversation_id: conversationId,
          wa_message_id: waMessageId,
        })
      );
      return;
    }

    await runAgent({
      organizationId,
      contactId,
      conversationId,
      waPhone,
      bookingState,
      bookingData,
      imageAttachment,
    });
  }
}

// ─── DB helper ────────────────────────────────────────────────────────────────

async function insertMessage(
  db: ReturnType<typeof createServiceClient>,
  conversationId: string,
  organizationId: string,
  waMessageId: string,
  content: string | null,
  raw: Json
): Promise<"ok" | "duplicate" | "error"> {
  // Use server receipt time, not WhatsApp's payload timestamp (whole seconds,
  // no ms) — mixing that with the ms-precision created_at we use for outbound
  // bot replies can invert ordering when the bot takes a few seconds to
  // respond, corrupting fetchMessageHistory's role alternation (a later
  // inbound message can sort before the bot's still-processing reply to the
  // previous one, ending the conversation on "assistant" instead of "user",
  // which Claude's API rejects outright).
  const createdAt = new Date().toISOString();

  const { error } = await db.from("messages").insert({
    conversation_id: conversationId,
    organization_id: organizationId,
    wa_message_id: waMessageId,
    direction: "inbound",
    sender: "contact",
    content,
    raw,
    created_at: createdAt,
  });

  if (error) {
    if (error.code === "23505") {
      console.log(
        JSON.stringify({ event: "duplicate_message", wa_message_id: waMessageId })
      );
      return "duplicate";
    }
    console.error(
      JSON.stringify({ event: "message_insert_error", wa_message_id: waMessageId, error: error.message })
    );
    return "error";
  }

  return "ok";
}
