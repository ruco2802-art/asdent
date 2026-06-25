import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import type { TablesUpdate } from "@/lib/database.types";

export function createSaveContactInfoTool(contactId: string) {
  return tool({
    description:
      "Actualiza los datos del contacto/paciente con información recolectada durante la conversación. Solo envía los campos que el paciente haya confirmado.",
    inputSchema: z.object({
      full_name: z
        .string()
        .optional()
        .describe("Nombre completo del paciente"),
      is_new_patient: z
        .boolean()
        .optional()
        .describe("Si es paciente nuevo en la clínica"),
      has_allergies: z
        .boolean()
        .optional()
        .describe("Si el paciente tiene alergias"),
      allergy_notes: z
        .string()
        .optional()
        .describe("Descripción de las alergias"),
      takes_anticoagulants: z
        .boolean()
        .optional()
        .describe("Si toma anticoagulantes"),
      medical_notes: z
        .string()
        .optional()
        .describe("Notas médicas adicionales"),
    }),
    execute: async (data) => {
      const updates: TablesUpdate<"contacts"> = {};
      if (data.full_name !== undefined) updates.full_name = data.full_name;
      if (data.is_new_patient !== undefined)
        updates.is_new_patient = data.is_new_patient;
      if (data.has_allergies !== undefined)
        updates.has_allergies = data.has_allergies;
      if (data.allergy_notes !== undefined)
        updates.allergy_notes = data.allergy_notes;
      if (data.takes_anticoagulants !== undefined)
        updates.takes_anticoagulants = data.takes_anticoagulants;
      if (data.medical_notes !== undefined)
        updates.medical_notes = data.medical_notes;

      if (Object.keys(updates).length === 0) return { ok: true };

      const db = createServiceClient();
      const { error } = await db
        .from("contacts")
        .update(updates)
        .eq("id", contactId);

      if (error) return { error: error.message };
      return { ok: true };
    },
  });
}
