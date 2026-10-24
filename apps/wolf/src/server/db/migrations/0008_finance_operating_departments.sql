-- Hotel operating departments for the shared Finance application.
-- These are not Wolf membership departments, and this migration copies no records.

create table if not exists finance_operating_departments (
  company_id text not null,
  department_code text not null,
  department_name text not null,
  active text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, department_code),
  constraint finance_operating_departments_company_fk foreign key (company_id) references companies (id) on delete restrict,
  constraint finance_operating_departments_code_check check (department_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  constraint finance_operating_departments_name_check check (length(btrim(department_name)) between 1 and 120),
  constraint finance_operating_departments_active_check check (active in ('Y', 'N'))
);
