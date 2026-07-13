-- Previene doble-booking a nivel de base de datos: dos citas activas (no
-- canceladas) de la misma organización no pueden compartir la misma hora
-- de inicio. Esta es la garantía de fondo, independiente de que Google
-- Calendar esté disponible.
--
-- Diagnóstico real (2026-07-13): Kevin Cano y Dairo Cano quedaron
-- agendados a la misma hora porque get_available_slots solo excluía
-- horarios ocupados vía Google Calendar FreeBusy, sin ningún respaldo
-- cuando Calendar fallaba (el token de la organización llevaba días
-- muerto, invalid_grant, de forma silenciosa).
create unique index if not exists appointments_org_starts_at_active_unique
  on appointments (organization_id, starts_at)
  where status != 'cancelled';

-- Marca cuando la creación del evento en Google Calendar falló después de
-- que la cita ya quedó confirmada en la base de datos, para que el
-- personal pueda detectar y reconciliar manualmente en vez de que la
-- desincronización pase inadvertida.
alter table appointments add column if not exists calendar_sync_error text;
