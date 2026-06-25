import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/database.types";

export function createSaveBookingProgressTool(conversationId: string) {
  return tool({
    description:
      "Guarda el progreso del formulario de agendamiento en la conversación. Llamar después de confirmar cada dato importante con el paciente para no perder el estado si el agente se reinicia.",
    inputSchema: z.object({
      booking_state: z
        .string()
        .describe(
          "Estado actual del flujo: 'collecting_service' | 'collecting_slot' | 'collecting_name' | 'collecting_new_patient' | 'collecting_medical_info' | 'confirming' | 'done'"
        ),
      booking_data: z
        .record(z.string(), z.unknown())
        .describe(
          "Datos recolectados hasta ahora (service, full_name, preferred_slot, is_new_patient, etc.)"
        ),
    }),
    execute: async ({ booking_state, booking_data }) => {
      const db = createServiceClient();
      const { error } = await db
        .from("conversations")
        .update({
          booking_state,
          // DECISION: any necesario — z.unknown() no es asignable a Json sin cast; los datos vienen validados por Zod
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          booking_data: booking_data as any as Json,
        })
        .eq("id", conversationId);

      if (error) return { error: error.message };
      return { ok: true };
    },
  });
}
