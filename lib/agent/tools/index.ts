import { createGetAvailableSlotsTool } from "./get-available-slots";
import { createBookAppointmentTool } from "./book-appointment";
import { createCancelAppointmentTool } from "./cancel-appointment";
import { createRescheduleAppointmentTool } from "./reschedule-appointment";
import { createSaveBookingProgressTool } from "./save-booking-progress";
import { createSaveContactInfoTool } from "./save-contact-info";
import { createRequestHumanHandoffTool } from "./request-human-handoff";

export interface AgentContext {
  organizationId: string;
  contactId: string;
  conversationId: string;
  waPhone: string; // E.164, e.g. "+573001234567"
}

interface CreateAgentToolsOptions {
  // true en el turno donde se detecta por primera vez una urgencia dental —
  // saca las tools de agendamiento para forzar una respuesta de puro texto
  // empático, sin competir contra el resultado de get_available_slots (ver
  // lib/agent/emergency-ack.ts).
  suppressScheduling?: boolean;
}

export function createAgentTools(ctx: AgentContext, options: CreateAgentToolsOptions = {}) {
  const tools = {
    get_available_slots: createGetAvailableSlotsTool(ctx.organizationId),
    book_appointment: createBookAppointmentTool(ctx),
    cancel_appointment: createCancelAppointmentTool(ctx),
    reschedule_appointment: createRescheduleAppointmentTool(ctx),
    save_booking_progress: createSaveBookingProgressTool(ctx.conversationId),
    save_contact_info: createSaveContactInfoTool(ctx.contactId),
    request_human_handoff: createRequestHumanHandoffTool(ctx),
  };

  if (options.suppressScheduling) {
    const { get_available_slots, book_appointment, ...rest } = tools;
    return rest;
  }

  return tools;
}
