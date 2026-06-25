// Extends WhatsApp MIME types to file extensions accepted by OpenAI Whisper
const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/aac": "aac",
};

/**
 * Transcribes audio using OpenAI Whisper (model whisper-1).
 * Uses the REST API directly to avoid adding the OpenAI SDK as a dependency.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const ext = MIME_TO_EXT[mimeType] ?? "ogg";
  const formData = new FormData();
  // DECISION: Uint8Array.from() produces Uint8Array<ArrayBuffer> (not ArrayBufferLike)
  // which TypeScript accepts as BlobPart — Buffer's .buffer is typed as ArrayBufferLike
  const blob = new Blob([Uint8Array.from(audioBuffer)], { type: mimeType });
  formData.append("file", blob, `audio.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("language", "es");
  formData.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Whisper API ${res.status}: ${errText}`);
  }

  const text = (await res.text()).trim();
  if (!text) throw new Error("Empty transcription from Whisper");
  return text;
}
