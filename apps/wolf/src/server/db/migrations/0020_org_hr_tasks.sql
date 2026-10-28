-- Links an organization task to one HR staff task in the same company.
-- Historical demo tasks stay valid when hr_external_id is null.

alter table org_tasks add column if not exists hr_external_id text;

alter table org_tasks drop constraint if exists org_tasks_demo_check;
alter table org_tasks add constraint org_tasks_demo_check check (
  (is_demo = true and id ~ '^demo-task-[a-z0-9-]{1,40}$')
  or (is_demo = false and hr_external_id is not null and id ~ '^hr-task-[a-z0-9-]{1,64}$')
);

alter table org_tasks drop constraint if exists org_tasks_hr_external_check;
alter table org_tasks add constraint org_tasks_hr_external_check check (
  hr_external_id is null or hr_external_id ~ '^[a-z0-9][a-z0-9:_-]{2,80}$'
);

alter table org_tasks drop constraint if exists org_tasks_hr_external_key;
alter table org_tasks add constraint org_tasks_hr_external_key unique (hr_external_id);
