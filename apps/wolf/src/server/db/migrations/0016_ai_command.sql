-- Company-scoped assistant conversations. Safe to run again.
-- Does not seed people, tasks, payroll, or grants.

create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  company_id text not null references companies (id) on delete restrict,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_conversations_title_check check (length(btrim(title)) between 1 and 120)
);

create index if not exists ai_conversations_user_updated on ai_conversations (user_id, updated_at);

create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null,
  content text not null,
  tool_name text,
  created_at timestamptz not null default now(),
  constraint ai_messages_role_check check (role in ('user', 'assistant', 'tool')),
  constraint ai_messages_content_check check (length(content) between 1 and 20000),
  constraint ai_messages_tool_check check (
    (role = 'tool' and tool_name is not null and length(tool_name) between 1 and 80)
    or (role <> 'tool' and tool_name is null)
  )
);

create index if not exists ai_messages_conversation_created on ai_messages (conversation_id, created_at);

create table if not exists ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null
);

create index if not exists ai_requests_user_created on ai_requests (user_id, created_at);
