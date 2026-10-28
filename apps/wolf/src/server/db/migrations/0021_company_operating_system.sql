-- Company operating structure, roles, and responsibilities.
-- Additive and safe to run again. Does not insert memberships, grants, or policies.
-- Does not enable row level security. Starter rows are written by the access service.

create table if not exists company_operating_units (
  company_id text not null references companies (id) on delete restrict,
  unit_code text not null,
  name text not null,
  summary text not null,
  profile text not null,
  sort_order integer not null,
  status text not null default 'active',
  primary key (company_id, unit_code),
  constraint company_operating_units_code_check check (unit_code ~ '^[a-z][a-z0-9-]{0,31}$'),
  constraint company_operating_units_name_check check (length(btrim(name)) between 1 and 80),
  constraint company_operating_units_summary_check check (length(summary) between 1 and 400),
  constraint company_operating_units_profile_check check (profile in ('hotel', 'neutral')),
  constraint company_operating_units_sort_check check (sort_order between 0 and 1000),
  constraint company_operating_units_status_check check (status in ('active', 'inactive'))
);

create table if not exists company_operating_roles (
  company_id text not null,
  role_code text not null,
  unit_code text not null,
  name text not null,
  summary text not null,
  profile text not null,
  status text not null default 'active',
  primary key (company_id, role_code),
  constraint company_operating_roles_unit_fk foreign key (company_id, unit_code) references company_operating_units (company_id, unit_code) on delete restrict,
  constraint company_operating_roles_code_check check (role_code ~ '^[a-z][a-z0-9-]{0,40}$'),
  constraint company_operating_roles_name_check check (length(btrim(name)) between 1 and 80),
  constraint company_operating_roles_summary_check check (length(summary) between 1 and 400),
  constraint company_operating_roles_profile_check check (profile in ('hotel', 'neutral')),
  constraint company_operating_roles_status_check check (status in ('active', 'inactive')),
  constraint company_operating_roles_wolf_name_check check (lower(btrim(name)) not in ('staff', 'administrator', 'owner'))
);

create table if not exists company_operating_responsibilities (
  company_id text not null,
  role_code text not null,
  responsibility_code text not null,
  label text not null,
  detail text not null,
  capability_id text not null,
  hotel_only boolean not null default false,
  profile text not null,
  sort_order integer not null,
  primary key (company_id, role_code, responsibility_code),
  constraint company_operating_responsibilities_role_fk foreign key (company_id, role_code) references company_operating_roles (company_id, role_code) on delete restrict,
  constraint company_operating_responsibilities_code_check check (responsibility_code ~ '^[a-z][a-z0-9.-]{0,63}$'),
  constraint company_operating_responsibilities_label_check check (length(btrim(label)) between 1 and 80),
  constraint company_operating_responsibilities_detail_check check (length(detail) between 1 and 400),
  constraint company_operating_responsibilities_profile_check check (profile in ('hotel', 'neutral')),
  constraint company_operating_responsibilities_hotel_check check (hotel_only = false or profile = 'hotel'),
  constraint company_operating_responsibilities_sort_check check (sort_order between 0 and 1000),
  constraint company_operating_responsibilities_capability_check check (capability_id in (
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
  )),
  constraint company_operating_responsibilities_private_check check (
    capability_id not in ('grant.owner_private', 'grant.approve.owner_private')
  )
);
