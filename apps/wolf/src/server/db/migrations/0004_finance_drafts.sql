-- Draft Finance foundation. Posting, reversal, tax, and hotel modules are not created.
-- Amounts are exact numeric values. Row level security stays disabled.
-- This file does not drop users, sessions, memberships, grants, or existing finance rows.

create table if not exists platform_operators (
  user_id uuid primary key references users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists finance_settings (
  company_id text primary key references companies (id) on delete restrict,
  currency_code text not null,
  minor_scale integer not null,
  created_at timestamptz not null default now(),
  constraint finance_settings_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint finance_settings_scale_check check (minor_scale between 0 and 4)
);

create table if not exists finance_periods (
  company_id text not null references companies (id) on delete restrict,
  period_key text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, period_key),
  constraint finance_periods_key_check check (period_key ~ '^[0-9]{4}-[0-9]{2}$')
);

create table if not exists finance_accounts (
  company_id text not null references companies (id) on delete restrict,
  account_code text not null,
  account_name text not null,
  active text not null default 'Y',
  created_at timestamptz not null default now(),
  primary key (company_id, account_code),
  constraint finance_accounts_code_check check (length(btrim(account_code)) > 0),
  constraint finance_accounts_active_check check (active in ('Y', 'N'))
);

create table if not exists finance_journals (
  company_id text not null references companies (id) on delete restrict,
  id text not null,
  period_key text not null,
  memo text not null default '',
  status text not null default 'draft',
  created_by uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (company_id, id),
  constraint finance_journals_status_check check (status = 'draft'),
  constraint finance_journals_period_fk foreign key (company_id, period_key) references finance_periods (company_id, period_key) on delete restrict
);

create table if not exists finance_journal_lines (
  company_id text not null,
  journal_id text not null,
  line_no integer not null,
  account_code text not null,
  debit numeric(20, 4) not null,
  credit numeric(20, 4) not null,
  primary key (company_id, journal_id, line_no),
  constraint finance_journal_lines_journal_fk foreign key (company_id, journal_id) references finance_journals (company_id, id) on delete restrict,
  constraint finance_journal_lines_account_fk foreign key (company_id, account_code) references finance_accounts (company_id, account_code) on delete restrict,
  constraint finance_journal_lines_sides_check check (
    debit >= 0 and credit >= 0
    and ((debit = 0 and credit > 0) or (credit = 0 and debit > 0))
  )
);
