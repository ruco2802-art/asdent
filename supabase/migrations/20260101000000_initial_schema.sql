-- ============================================================
-- ASDENT — Esquema inicial (idempotente)
-- Orden: tablas primero, luego policies (evita dependencias circulares)
-- ============================================================

-- ============================================================
-- TABLAS (sin policies aún)
-- ============================================================

create table if not exists organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  timezone      text not null default 'America/Bogota',
  business_type text not null default 'dental'
                  check (business_type in ('dental', 'general')),
  created_at    timestamptz default now()
);

create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  full_name       text,
  role            text check (role in ('owner', 'staff')) default 'owner',
  created_at      timestamptz default now()
);

create table if not exists whatsapp_configs (
  organization_id         uuid primary key references organizations(id) on delete cascade,
  phone_number_id         text not null,
  waba_id                 text not null,
  access_token_encrypted  text not null,
  verify_token            text not null,
  app_secret_encrypted    text not null,
  updated_at              timestamptz default now()
);

create table if not exists google_calendar_configs (
  organization_id           uuid primary key references organizations(id) on delete cascade,
  calendar_id               text not null,
  refresh_token_encrypted   text not null,
  access_token_encrypted    text,
  token_expires_at          timestamptz,
  updated_at                timestamptz default now()
);

create table if not exists agent_configs (
  organization_id       uuid primary key references organizations(id) on delete cascade,
  system_prompt         text not null,
  tone                  text not null default 'profesional y cálido',
  business_info         jsonb not null default '{}'::jsonb,
  services              jsonb not null default '[]'::jsonb,
  business_hours        jsonb not null default '{}'::jsonb,
  handoff_message       text default 'Te comunico con un miembro de nuestro equipo en un momento. ¡Gracias por tu paciencia!',
  confirmation_template text default 'Tu cita ha sido confirmada para el {fecha} a las {hora}. Recuerda llegar 10 minutos antes. Para cancelar o reprogramar escríbenos con al menos 24 horas de anticipación.',
  updated_at            timestamptz default now()
);

create table if not exists contacts (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  wa_phone             text not null,
  full_name            text,
  is_new_patient       boolean,
  has_allergies        boolean,
  allergy_notes        text,
  takes_anticoagulants boolean,
  medical_notes        text,
  metadata             jsonb default '{}'::jsonb,
  created_at           timestamptz default now(),
  unique (organization_id, wa_phone)
);

create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  bot_active      boolean default true,
  booking_state   text default null,
  booking_data    jsonb default '{}'::jsonb,
  last_message_at timestamptz default now(),
  created_at      timestamptz default now()
);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  wa_message_id   text,
  direction       text not null check (direction in ('inbound', 'outbound')),
  sender          text not null check (sender in ('contact', 'bot', 'human')),
  content         text,
  raw             jsonb,
  created_at      timestamptz default now()
);

create table if not exists appointments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  service         text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  google_event_id text,
  status          text check (status in ('confirmed', 'cancelled', 'completed')) default 'confirmed',
  is_new_patient  boolean,
  is_urgent       boolean default false,
  full_name       text not null,
  phone           text not null,
  notes           text,
  medical_notes   text,
  created_at      timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create unique index if not exists messages_wa_message_id_unique
  on messages(wa_message_id)
  where wa_message_id is not null;

create index if not exists idx_messages_conversation_created
  on messages(conversation_id, created_at desc);

create index if not exists idx_conversations_org_last_msg
  on conversations(organization_id, last_message_at desc);

create index if not exists idx_appointments_org_starts
  on appointments(organization_id, starts_at);

create index if not exists idx_appointments_org_urgent_starts
  on appointments(organization_id, is_urgent, starts_at);

create index if not exists idx_contacts_org_phone
  on contacts(organization_id, wa_phone);

create index if not exists idx_whatsapp_configs_phone_number_id
  on whatsapp_configs(phone_number_id);

-- ============================================================
-- TRIGGER: crea profile vacío al registrarse (org se enlaza en Paso 3)
-- ============================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- RLS + POLICIES (todas las tablas ya existen aquí)
-- ============================================================
alter table organizations          enable row level security;
alter table profiles               enable row level security;
alter table whatsapp_configs       enable row level security;
alter table google_calendar_configs enable row level security;
alter table agent_configs          enable row level security;
alter table contacts               enable row level security;
alter table conversations          enable row level security;
alter table messages               enable row level security;
alter table appointments           enable row level security;

-- organizations
drop policy if exists "org_select" on organizations;
create policy "org_select" on organizations for select
  using (id in (select organization_id from profiles where id = auth.uid()));

drop policy if exists "org_update" on organizations;
create policy "org_update" on organizations for update
  using (id in (select organization_id from profiles where id = auth.uid()));

-- profiles
drop policy if exists "profile_select" on profiles;
create policy "profile_select" on profiles for select
  using (id = auth.uid());

drop policy if exists "profile_update" on profiles;
create policy "profile_update" on profiles for update
  using (id = auth.uid());

-- whatsapp_configs
drop policy if exists "whatsapp_config_all" on whatsapp_configs;
create policy "whatsapp_config_all" on whatsapp_configs for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));

-- google_calendar_configs
drop policy if exists "google_config_all" on google_calendar_configs;
create policy "google_config_all" on google_calendar_configs for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));

-- agent_configs
drop policy if exists "agent_config_all" on agent_configs;
create policy "agent_config_all" on agent_configs for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));

-- contacts
drop policy if exists "contacts_all" on contacts;
create policy "contacts_all" on contacts for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));

-- conversations
drop policy if exists "conversations_all" on conversations;
create policy "conversations_all" on conversations for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));

-- messages
drop policy if exists "messages_all" on messages;
create policy "messages_all" on messages for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));

-- appointments
drop policy if exists "appointments_all" on appointments;
create policy "appointments_all" on appointments for all
  using (organization_id in (select organization_id from profiles where id = auth.uid()));
