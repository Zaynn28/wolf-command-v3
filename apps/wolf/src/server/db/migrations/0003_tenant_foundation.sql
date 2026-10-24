-- Company and department boundaries for existing memberships and grants.
-- schema.sql and 0002 stay in place. This file does not drop users, sessions,
-- memberships, grants, or audit rows. Row level security stays disabled.
-- Safe to run again. Apply only through pnpm db:migrate after review.

create table if not exists companies (
  id text primary key,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_id_check check (length(btrim(id)) > 0),
  constraint companies_status_check check (status in ('active', 'disabled'))
);

create table if not exists departments (
  company_id text not null references companies (id) on delete restrict,
  id text not null,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id),
  constraint departments_id_check check (length(btrim(id)) > 0),
  constraint departments_status_check check (status in ('active', 'disabled'))
);

insert into companies (id, name)
select distinct source.company_id, source.company_id
from (
  select company_id from memberships
  union
  select company_id from grants
) as source
where length(btrim(source.company_id)) > 0
  and not exists (
    select 1 from companies existing where existing.id = source.company_id
  );

insert into departments (company_id, id, name)
select distinct source.company_id, source.department_id, source.department_id
from (
  select company_id, department_id from memberships where department_id is not null
  union
  select company_id, department_id from grants where department_id is not null
) as source
where length(btrim(source.department_id)) > 0
  and not exists (
    select 1 from departments existing
    where existing.company_id = source.company_id and existing.id = source.department_id
  );

alter table memberships drop constraint if exists memberships_company_fk;
alter table memberships
  add constraint memberships_company_fk
  foreign key (company_id) references companies (id) on delete restrict;

alter table memberships drop constraint if exists memberships_department_fk;
alter table memberships
  add constraint memberships_department_fk
  foreign key (company_id, department_id) references departments (company_id, id) on delete restrict;

alter table grants drop constraint if exists grants_company_fk;
alter table grants
  add constraint grants_company_fk
  foreign key (company_id) references companies (id) on delete restrict;

alter table grants drop constraint if exists grants_department_fk;
alter table grants
  add constraint grants_department_fk
  foreign key (company_id, department_id) references departments (company_id, id) on delete restrict;

create index if not exists memberships_company on memberships (company_id);
create index if not exists grants_company on grants (company_id);

alter table audit_events add column if not exists company_id text;
alter table audit_events add column if not exists resource_type text;
alter table audit_events add column if not exists resource_id text;

alter table audit_events drop constraint if exists audit_events_company_fk;
alter table audit_events
  add constraint audit_events_company_fk
  foreign key (company_id) references companies (id) on delete restrict;

alter table audit_events drop constraint if exists audit_events_resource_check;
alter table audit_events
  add constraint audit_events_resource_check check (
    (resource_type is null and resource_id is null)
    or (
      resource_type is not null
      and length(btrim(resource_type)) > 0
      and resource_id is not null
      and length(btrim(resource_id)) > 0
    )
  );

create index if not exists audit_events_company_created on audit_events (company_id, created_at);
