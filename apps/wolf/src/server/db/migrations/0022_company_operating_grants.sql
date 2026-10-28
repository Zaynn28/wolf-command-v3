-- Operating-role interface and feature grants.
-- Additive and safe to run again. Does not insert memberships, policy grants, or role assignments.
-- Does not enable row level security.

create table if not exists company_operating_role_grants (
  company_id text not null,
  role_code text not null,
  grant_code text not null,
  enabled boolean not null,
  profile text not null,
  hotel_only boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (company_id, role_code, grant_code),
  constraint company_operating_role_grants_role_fk foreign key (company_id, role_code) references company_operating_roles (company_id, role_code) on delete restrict,
  constraint company_operating_role_grants_code_check check (grant_code ~ '^[a-z][a-z0-9.-]{0,63}$'),
  constraint company_operating_role_grants_profile_check check (profile in ('hotel', 'neutral')),
  constraint company_operating_role_grants_hotel_check check (hotel_only = false or profile = 'hotel'),
  constraint company_operating_role_grants_hotel_code_check check (
    profile = 'hotel'
    or grant_code not in (
      'finance.usali',
      'finance.owner-pool',
      'finance.integrations',
      'finance.service-charge',
      'finance.night-audit',
      'finance.pms',
      'finance.guest-ledger',
      'rooms.interface'
    )
  ),
  constraint company_operating_role_grants_private_check check (
    grant_code not in (
      'owner_private',
      'grant.owner_private',
      'grant.approve.owner_private',
      'finance.journal.post',
      'finance.post',
      'finance.draft.approve',
      'assistant.key'
    )
  )
);

create index if not exists company_operating_role_grants_company_idx
  on company_operating_role_grants (company_id, role_code);

create table if not exists company_operating_role_assignments (
  company_id text not null,
  role_code text not null,
  user_id uuid not null references users (id) on delete restrict,
  assigned_at timestamptz not null,
  primary key (company_id, role_code, user_id),
  constraint company_operating_role_assignments_role_fk foreign key (company_id, role_code) references company_operating_roles (company_id, role_code) on delete restrict
);

create index if not exists company_operating_role_assignments_user_idx
  on company_operating_role_assignments (user_id, company_id);
