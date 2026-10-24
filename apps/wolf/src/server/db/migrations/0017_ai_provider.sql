-- Portal assistant provider settings. Safe to run again.
-- Does not seed people, tasks, payroll, grants, or provider credentials.

create table if not exists ai_provider_settings (
  id text primary key,
  model text not null,
  api_key text,
  updated_by uuid references users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint ai_provider_settings_id_check check (id = 'grok'),
  constraint ai_provider_settings_model_check check (model ~ '^grok-[a-z0-9][a-z0-9.-]{0,40}$'),
  constraint ai_provider_settings_key_check check (api_key is null or length(api_key) between 20 and 300)
);
