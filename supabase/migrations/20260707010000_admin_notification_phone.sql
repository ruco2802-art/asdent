-- Teléfono de WhatsApp del dueño/administrador de la clínica, para
-- notificarle cuando se crea una alerta (handoff o cita en riesgo).
-- E.164, ej. "+573001234567" — mismo formato que contacts.wa_phone.
alter table organizations
  add column if not exists notification_phone text;
