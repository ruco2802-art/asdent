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

export function createAgentTools(ctx: AgentContext) {
  return {
    get_available_slots: createGetAvailableSlotsTool(ctx.organizationId),
    book_appointment: createBookAppointmentTool(ctx),
    cancel_appointment: createCancelAppointmentTool(ctx),
    reschedule_appointment: createRescheduleAppointmentTool(ctx),
    save_booking_progress: createSaveBookingProgressTool(ctx.conversationId),
    save_contact_info: createSaveContactInfoTool(ctx.contactId),
    request_human_handoff: createRequestHumanHandoffTool(ctx),
  };
}
