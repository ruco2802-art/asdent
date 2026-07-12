import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// Heurística rápida y gratuita, no un clasificador — no va a atrapar cada
// forma posible de describir una urgencia dental. Cuando no matchea, el
// flujo normal del agente sigue igual (sin el mensaje de empatía aparte).
const EMERGENCY_PATTERNS: RegExp[] = [
  /se me (parti|romp|quebr)[oó]?.{0,15}\b(muela|diente)/i,
  /(muela|diente).{0,15}(se me )?(parti|romp|quebr)/i,
  /se me cay[oó] (un |el )?diente/i,
  /golpe.{0,15}(diente|muela)/i,
  /(diente|muela).{0,15}golpe/i,
  /sangr/i,
  /(muela|diente).{0,20}hincha/i,
  /hincha.{0,20}(muela|diente)/i,
  /dolor (fuerte|insoportable|intenso)/i,
  /mucho dolor/i,
  /\burgencia\b/i,
  /\bemergencia\b/i,
];

export function isEmergencyMessage(text: string | null): boolean {
  if (!text) return false;
  return EMERGENCY_PATTERNS.some((re) => re.test(text));
}

// Generación separada del flujo principal del agente — a propósito sin
// tools ni contexto de agendamiento. Pruebas en vivo mostraron que cuando
// la empatía y el resultado de get_available_slots se generan en la misma
// respuesta, el modelo siempre prioriza la hora disponible sobre la
// reacción humana, sin importar cómo se redacte la instrucción. Separarlo
// en una llamada propia saca a la empatía de esa competencia.
export async function generateEmergencyAck(
  patientMessage: string,
  assistantName: string,
  clinicName: string
): Promise<string> {
  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    system: `Eres ${assistantName}, recepcionista de ${clinicName}, una clínica dental en Neiva. Un paciente te acaba de escribir algo que suena a una urgencia o trauma dental. Respóndele en 1-2 líneas, cálida y específica a lo que contó — SOLO una reacción humana de reconocimiento. No ofrezcas horarios, no hagas preguntas de logística, no menciones agendar todavía — eso lo maneja otro mensaje que llega justo después tuyo. Máximo 1 emoji, al final. Habla como una colombiana de Neiva, natural — nunca como manual corporativo ni como chatbot genérico.`,
    prompt: `El paciente escribió: "${patientMessage}"`,
    temperature: 0.4,
  });
  return text.trim();
}
