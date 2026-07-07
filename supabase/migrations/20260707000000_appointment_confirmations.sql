-- ============================================================
-- Sistema de confirmación de citas + tabla de alertas genérica
-- ============================================================

-- ── alerts ──────────────────────────────────────────────────
-- Tabla única y reutilizable para cualquier situación que requiera
-- atención humana — hoy: handoff solicitado y citas en riesgo de
-- no confirmarse. Futuro: cualquier otro tipo sin nueva tabla.
create table if not exists alerts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type            text not null check (type in ('handoff_needed', 'appointment_at_risk')),
  conversation_id uuid references conversations(id) on delete cascade,
  appointment_id  uuid references appointments(id) on delete cascade,
  message         text not null,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz default now()
);

create index if not exists idx_alerts_org_status
  on alerts(organization_id, status);

alter table alerts enable row level security;

drop policy if exists "alerts_all" on alerts;
create policy "alerts_all" on alerts for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));

-- ── appointments: estado de confirmación ───────────────────
alter table appointments
  add column if not exists confirmation_status text
    not null default 'pending'
    check (confirmation_status in
      ('pending', 'awaiting_confirmation', 'confirmed', 'at_risk', 'cancelled', 'rescheduled'));

-- Soporte para la lógica de reintentos (punto 5): cuándo se envió el
-- último recordatorio y cuántas veces, para que el cron sepa si ya
-- pasaron 4h sin respuesta y si le queda algún reintento.
alter table appointments
  add column if not exists confirmation_sent_at timestamptz;

alter table appointments
  add column if not exists confirmation_attempts int not null default 0;

create index if not exists idx_appointments_confirmation_status
  on appointments(organization_id, confirmation_status);
