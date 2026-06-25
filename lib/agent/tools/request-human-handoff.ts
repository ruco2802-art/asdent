import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import type { AgentConfig } from "@/lib/database.types";

interface HandoffContext {
  organizationId: string;
  conversationId: string;
  waPhone: string;
}

const DEFAULT_HANDOFF_MESSAGE =
  "Te comunico con un miembro de nuestro equipo en un momento. ¡Gracias por tu paciencia! 🙏";

export function createRequestHumanHandoffTool(ctx: HandoffContext) {
  const { organizationId, conversationId, waPhone } = ctx;

  return tool({
    description:
      "Transfiere la conversación a un humano y desactiva el bot. Usar cuando el paciente lo solicite, cuando no puedas resolver algo, cuando no haya slots urgentes disponibles, o cuando solicite cancelar o reprogramar una cita existente.",
    inputSchema: z.object({
      reason: z
        .string()
        .optional()
        .describe(
          "Razón de la transferencia: 'solicitado_por_paciente' | 'no_comprendo' | 'urgencia_sin_slot' | 'cancelacion_solicitada' | 'otro'"
        ),
    }),
    execute: async ({ reason = "otro" }) => {
      const db = createServiceClient();

      const { data: rawConfig } = await db
        .from("agent_configs")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      // DECISION: cast necesario — supabase-js@2.49.9 infiere never para .maybeSingle() con tipos manuales
      const config = rawConfig as AgentConfig | null;
      const handoffMessage =
        config?.handoff_message ?? DEFAULT_HANDOFF_MESSAGE;

      // Desactivar bot primero para que si falla el mensaje igual se transfiere
      await db
        .from("conversations")
        .update({ bot_active: false })
        .eq("id", conversationId);

      let wamid: string | null = null;
      try {
        wamid = await sendWhatsAppMessage(organizationId, waPhone, handoffMessage);
      } catch {
        console.error(
          JSON.stringify({
            event: "handoff_send_error",
            conversation_id: conversationId,
          })
        );
      }

      // Persistir el mensaje enviado
      if (wamid) {
        await db.from("messages").insert({
          conversation_id: conversationId,
          organization_id: organizationId,
          wa_message_id: wamid,
          direction: "outbound",
          sender: "bot",
          content: handoffMessage,
          created_at: new Date().toISOString(),
        });
      }

      return {
        ok: true,
        reason,
        message: "Conversación transferida al equipo humano. Bot desactivado.",
      };
    },
  });
}
