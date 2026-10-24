-- Demo organization and task tables. Safe to run again.
-- Does not insert people, tasks, or login accounts.
-- Existing department rows stay is_demo = false.

alter table departments add column if not exists is_demo boolean not null default false;

create table if not exists org_people (
  id text primary key,
  display_name text not null,
  employment_status text not null,
  is_demo boolean not null,
  linked_user_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_people_demo_check check (is_demo = true and id ~ '^demo-[a-z0-9-]{1,48}$'),
  constraint org_people_status_check check (employment_status in ('active', 'leave', 'inactive')),
  constraint org_people_name_check check (length(btrim(display_name)) between 1 and 120)
);

create table if not exists org_positions (
  id text primary key,
  company_id text not null,
  department_id text not null,
  title text not null,
  is_demo boolean not null,
  created_at timestamptz not null default now(),
  constraint org_positions_department_fk foreign key (company_id, department_id) references departments (company_id, id) on delete restrict,
  constraint org_positions_demo_check check (is_demo = true and id ~ '^demo-pos-[a-z0-9-]{1,40}$'),
  constraint org_positions_title_check check (length(btrim(title)) between 1 and 120)
);

create table if not exists org_assignments (
  id text primary key,
  person_id text not null references org_people (id) on delete restrict,
  position_id text not null references org_positions (id) on delete restrict,
  company_id text not null,
  department_id text not null,
  manager_person_id text references org_people (id) on delete restrict,
  is_demo boolean not null,
  constraint org_assignments_department_fk foreign key (company_id, department_id) references departments (company_id, id) on delete restrict,
  constraint org_assignments_person_company unique (person_id, company_id),
  constraint org_assignments_demo_check check (is_demo = true and id ~ '^demo-asg-[a-z0-9-]{1,40}$')
);

create table if not exists org_tasks (
  id text primary key,
  company_id text not null references companies (id) on delete restrict,
  department_id text,
  title text not null,
  description text not null,
  priority text not null,
  due_on date not null,
  completion_criteria text not null,
  review_required boolean not null,
  status text not null,
  assignee_person_id text references org_people (id) on delete restrict,
  team_department_id text,
  evidence_url text,
  created_by_user_id uuid references users (id) on delete restrict,
  submitted_by_user_id uuid references users (id) on delete restrict,
  is_demo boolean not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_tasks_department_fk foreign key (company_id, department_id) references departments (company_id, id) on delete restrict,
  constraint org_tasks_team_department_fk foreign key (company_id, team_department_id) references departments (company_id, id) on delete restrict,
  constraint org_tasks_demo_check check (is_demo = true and id ~ '^demo-task-[a-z0-9-]{1,40}$'),
  constraint org_tasks_priority_check check (priority in ('low', 'normal', 'high')),
  constraint org_tasks_status_check check (status in ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED')),
  constraint org_tasks_assignment_check check (assignee_person_id is not null or team_department_id is not null),
  constraint org_tasks_title_check check (length(btrim(title)) between 1 and 160),
  constraint org_tasks_evidence_check check (evidence_url is null or evidence_url ~ '^https://.{1,280}$')
);

create index if not exists org_tasks_company_status on org_tasks (company_id, status);

create table if not exists org_task_events (
  id text primary key,
  task_id text not null references org_tasks (id) on delete restrict,
  actor_user_id uuid references users (id) on delete restrict,
  actor_source text not null,
  previous_status text,
  next_status text not null,
  reason text,
  created_at timestamptz not null,
  constraint org_task_events_actor_check check (
    (actor_source = 'user' and actor_user_id is not null)
    or (actor_source = 'demo-seed' and actor_user_id is null)
  ),
  constraint org_task_events_status_check check (
    next_status in ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'COMPLETED')
  )
);

create index if not exists org_task_events_task_created on org_task_events (task_id, created_at);
