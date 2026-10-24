-- Wolf-owned authentication schema. Local development migration.
-- Apply with: pnpm --filter wolf db:migrate
-- This file does not seed users, memberships, or grants.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_check check (status in ('active', 'disabled')),
  constraint users_email_normalized_check check (
    email_normalized = lower(email_normalized)
    and length(email_normalized) between 3 and 254
  )
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  company_id text not null,
  department_id text,
  role text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_role_check check (role in ('staff', 'administrator', 'owner')),
  constraint memberships_status_check check (status in ('active', 'disabled')),
  constraint memberships_company_check check (length(trim(company_id)) > 0)
);

create unique index if not exists memberships_user_company_department
  on memberships (user_id, company_id, coalesce(department_id, ''));

create table if not exists grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  grant_type text not null,
  company_id text not null,
  scope text,
  department_id text,
  created_at timestamptz not null default now(),
  constraint grants_shape_check check (
    (
      grant_type = 'owner_private'
      and scope is null
      and department_id is null
      and length(trim(company_id)) > 0
    )
    or (
      grant_type = 'approve'
      and scope in ('company', 'owner_private')
      and department_id is null
      and length(trim(company_id)) > 0
    )
    or (
      grant_type = 'approve'
      and scope = 'department'
      and department_id is not null
      and length(trim(department_id)) > 0
      and length(trim(company_id)) > 0
    )
  )
);

create unique index if not exists grants_owner_private_once
  on grants (user_id, company_id)
  where grant_type = 'owner_private';

create unique index if not exists grants_approve_once
  on grants (user_id, company_id, scope, coalesce(department_id, ''))
  where grant_type = 'approve';

create table if not exists otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  email_normalized text not null,
  purpose text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null,
  consumed_at timestamptz,
  superseded_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz not null,
  constraint otp_purpose_check check (purpose = 'sign_in'),
  constraint otp_attempt_check check (attempt_count >= 0 and max_attempts > 0),
  constraint otp_hash_check check (code_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists otp_one_active_per_email
  on otp_challenges (email_normalized, purpose)
  where consumed_at is null and superseded_at is null;

create index if not exists otp_challenges_email_created
  on otp_challenges (email_normalized, created_at desc);

create table if not exists auth_attempts (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  ip text,
  kind text not null,
  created_at timestamptz not null,
  constraint auth_attempts_kind_check check (kind in ('send', 'verify'))
);

create index if not exists auth_attempts_email_kind_created
  on auth_attempts (kind, email_normalized, created_at);

create index if not exists auth_attempts_ip_kind_created
  on auth_attempts (kind, ip, created_at);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  constraint sessions_hash_check check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists sessions_user_id on sessions (user_id);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete set null,
  event_type text not null,
  email_fingerprint text,
  ip text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  constraint audit_events_type_check check (
    event_type in (
      'sign_in_code_issued',
      'sign_in_suppressed',
      'sign_in_rate_limited',
      'verify_rate_limited',
      'email_failed',
      'otp_rejected_mismatch',
      'otp_rejected_expired',
      'otp_rejected_attempts',
      'otp_rejected_used',
      'otp_verified',
      'session_created',
      'session_revoked',
      'authorization_allowed',
      'authorization_denied'
    )
  )
);

create index if not exists audit_events_created on audit_events (created_at);
create index if not exists audit_events_user on audit_events (user_id);
