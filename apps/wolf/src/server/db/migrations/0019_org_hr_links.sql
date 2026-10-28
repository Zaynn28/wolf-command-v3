-- Thin assignee link for a company's HR employees.
-- Does not copy payroll fields, contact fields, or national IDs.
-- Does not delete demo people or historical task rows.

alter table org_people add column if not exists source text;
alter table org_people add column if not exists company_id text;
alter table org_people add column if not exists employee_code text;
alter table org_people add column if not exists department_name text;
alter table org_people add column if not exists position_title text;

update org_people
set source = 'demo'
where source is null
  and is_demo = true;

alter table org_people alter column source set default 'demo';
alter table org_people alter column source set not null;

alter table org_people drop constraint if exists org_people_demo_check;
alter table org_people add constraint org_people_demo_check check ((source = 'demo' and is_demo = true and id ~ '^demo-[a-z0-9-]{1,48}$' and company_id is null and employee_code is null) or (source = 'hr' and is_demo = false and company_id in ('amg', 'bzg', 'ggv') and employee_code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$' and id ~ '^hr-[a-z0-9-]{1,64}$'));

alter table org_people drop constraint if exists org_people_department_check;
alter table org_people add constraint org_people_department_check check (department_name is null or length(btrim(department_name)) between 1 and 120);

alter table org_people drop constraint if exists org_people_position_check;
alter table org_people add constraint org_people_position_check check (position_title is null or length(btrim(position_title)) between 1 and 120);

alter table org_people drop constraint if exists org_people_company_fk;
alter table org_people add constraint org_people_company_fk foreign key (company_id) references companies (id) on delete restrict;

alter table org_people drop constraint if exists org_people_hr_code_key;
alter table org_people add constraint org_people_hr_code_key unique (company_id, employee_code);
