alter table agent_configs
  add column if not exists assistant_name text default 'Valentina';
