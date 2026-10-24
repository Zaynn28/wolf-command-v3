-- Access policy positions, roles, and published memberships. Safe to run again.
-- Does not create login accounts. Does not grant Owner Private by itself.

alter table memberships add column if not exists origin text not null default 'provisioned';
alter table memberships add column if not exists expires_at timestamptz;
alter table memberships add column if not exists policy_version_id uuid;

alter table memberships drop constraint if exists memberships_origin_check;
alter table memberships add constraint memberships_origin_check check (origin in ('provisioned', 'policy'));

alter table grants add column if not exists origin text not null default 'provisioned';
alter table grants add column if not exists status text not null default 'active';
alter table grants add column if not exists expires_at timestamptz;
alter table grants add column if not exists policy_version_id uuid;

alter table grants drop constraint if exists grants_origin_check;
alter table grants add constraint grants_origin_check check (origin in ('provisioned', 'policy'));
alter table grants drop constraint if exists grants_status_check;
alter table grants add constraint grants_status_check check (status in ('active', 'disabled'));

drop index if exists memberships_user_company_department;
create unique index memberships_user_company_department
  on memberships (user_id, company_id, coalesce(department_id, ''))
  where status = 'active';

drop index if exists grants_owner_private_once;
create unique index grants_owner_private_once
  on grants (user_id, company_id)
  where grant_type = 'owner_private' and status = 'active';

drop index if exists grants_approve_once;
create unique index grants_approve_once
  on grants (user_id, company_id, scope, coalesce(department_id, ''))
  where grant_type = 'approve' and status = 'active';

create table if not exists access_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  status text not null,
  created_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_roles_status_check check (status in ('active', 'inactive')),
  constraint access_roles_name_check check (length(btrim(name)) between 1 and 80)
);

create unique index if not exists access_roles_active_name
  on access_roles (lower(name))
  where status = 'active';

create table if not exists access_role_capabilities (
  role_id uuid not null references access_roles (id) on delete restrict,
  capability_id text not null,
  primary key (role_id, capability_id),
  constraint access_role_capabilities_id_check check (capability_id in (
    'membership.company.staff',
    'membership.company.administrator',
    'membership.company.owner',
    'membership.department.finance.staff',
    'membership.department.finance.administrator',
    'membership.department.hr.staff',
    'membership.department.hr.administrator',
    'membership.department.content.staff',
    'membership.department.content.administrator',
    'membership.department.procurement.staff',
    'membership.department.procurement.administrator',
    'grant.owner_private',
    'grant.approve.company',
    'grant.approve.owner_private',
    'grant.approve.department.finance',
    'grant.approve.department.hr',
    'grant.approve.department.content',
    'grant.approve.department.procurement'
  ))
);

create table if not exists access_positions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies (id) on delete restrict,
  department_id text,
  name text not null,
  description text not null default '',
  reports_to_id uuid,
  suggested_role_id uuid references access_roles (id) on delete restrict,
  status text not null,
  created_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_positions_department_fk foreign key (company_id, department_id) references departments (company_id, id) on delete restrict,
  constraint access_positions_reports_to_fk foreign key (reports_to_id) references access_positions (id) on delete restrict,
  constraint access_positions_status_check check (status in ('active', 'inactive')),
  constraint access_positions_name_check check (length(btrim(name)) between 1 and 80)
);

create unique index if not exists access_positions_active_name
  on access_positions (company_id, lower(name))
  where status = 'active';

create table if not exists access_position_holders (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references access_positions (id) on delete restrict,
  user_id uuid not null references users (id) on delete restrict,
  status text not null,
  created_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint access_position_holders_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists access_position_holders_once
  on access_position_holders (position_id, user_id);

create table if not exists access_policy_versions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references companies (id) on delete restrict,
  version_number integer not null,
  status text not null,
  reason text not null,
  created_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  based_on_version_id uuid,
  constraint access_policy_versions_status_check check (status in ('draft', 'published', 'superseded')),
  constraint access_policy_versions_reason_check check (length(btrim(reason)) between 1 and 400),
  constraint access_policy_versions_number unique (company_id, version_number),
  constraint access_policy_versions_based_on_fk foreign key (based_on_version_id) references access_policy_versions (id) on delete restrict
);

create unique index if not exists access_policy_one_draft
  on access_policy_versions (company_id)
  where status = 'draft';

create unique index if not exists access_policy_one_published
  on access_policy_versions (company_id)
  where status = 'published';

create table if not exists access_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references access_policy_versions (id) on delete restrict,
  user_id uuid not null references users (id) on delete restrict,
  company_id text not null references companies (id) on delete restrict,
  department_id text,
  role_id uuid references access_roles (id) on delete restrict,
  kind text not null,
  effect text not null,
  capability_id text,
  justification text,
  expires_at timestamptz,
  constraint access_policy_assignments_department_fk foreign key (company_id, department_id) references departments (company_id, id) on delete restrict,
  constraint access_policy_assignments_kind_check check (kind in ('assignment', 'exception')),
  constraint access_policy_assignments_effect_check check (effect in ('allow', 'deny')),
  constraint access_policy_assignments_shape_check check (
    (
      kind = 'assignment'
      and effect = 'allow'
      and role_id is not null
      and capability_id is null
      and justification is null
      and expires_at is null
    )
    or (
      kind = 'exception'
      and role_id is null
      and capability_id is not null
      and justification is not null
      and length(btrim(justification)) between 8 and 400
      and expires_at is not null
    )
  )
);

create unique index if not exists access_policy_assignment_user
  on access_policy_assignments (version_id, user_id)
  where kind = 'assignment';

create unique index if not exists access_policy_exception_once
  on access_policy_assignments (version_id, user_id, capability_id)
  where kind = 'exception';

create table if not exists access_policy_snapshots (
  version_id uuid not null references access_policy_versions (id) on delete restrict,
  assignment_id uuid not null,
  user_id uuid not null,
  company_id text not null,
  department_id text,
  capability_id text not null,
  effect text not null,
  expires_at timestamptz,
  primary key (version_id, assignment_id, capability_id),
  constraint access_policy_snapshots_effect_check check (effect in ('allow', 'deny')),
  constraint access_policy_snapshots_capability_check check (capability_id in (
    'membership.company.staff',
    'membership.company.administrator',
    'membership.company.owner',
    'membership.department.finance.staff',
    'membership.department.finance.administrator',
    'membership.department.hr.staff',
    'membership.department.hr.administrator',
    'membership.department.content.staff',
    'membership.department.content.administrator',
    'membership.department.procurement.staff',
    'membership.department.procurement.administrator',
    'grant.owner_private',
    'grant.approve.company',
    'grant.approve.owner_private',
    'grant.approve.department.finance',
    'grant.approve.department.hr',
    'grant.approve.department.content',
    'grant.approve.department.procurement'
  ))
);

create table if not exists access_policy_changes (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references access_policy_versions (id) on delete restrict,
  user_id uuid not null references users (id) on delete restrict,
  company_id text not null,
  capability_id text not null,
  change_kind text not null,
  created_at timestamptz not null,
  constraint access_policy_changes_kind_check check (change_kind in ('granted', 'revoked')),
  constraint access_policy_changes_capability_check check (capability_id in (
    'membership.company.staff',
    'membership.company.administrator',
    'membership.company.owner',
    'membership.department.finance.staff',
    'membership.department.finance.administrator',
    'membership.department.hr.staff',
    'membership.department.hr.administrator',
    'membership.department.content.staff',
    'membership.department.content.administrator',
    'membership.department.procurement.staff',
    'membership.department.procurement.administrator',
    'grant.owner_private',
    'grant.approve.company',
    'grant.approve.owner_private',
    'grant.approve.department.finance',
    'grant.approve.department.hr',
    'grant.approve.department.content',
    'grant.approve.department.procurement'
  ))
);

create index if not exists access_policy_changes_version on access_policy_changes (version_id);

alter table memberships drop constraint if exists memberships_policy_version_fk;
alter table memberships
  add constraint memberships_policy_version_fk
  foreign key (policy_version_id) references access_policy_versions (id) on delete restrict;

alter table grants drop constraint if exists grants_policy_version_fk;
alter table grants
  add constraint grants_policy_version_fk
  foreign key (policy_version_id) references access_policy_versions (id) on delete restrict;
