-- Atrium chart of accounts, one row per company and account code.
-- Separate from finance_accounts, which remains the Wolf draft-ledger chart.
-- Mapping configuration stores free-text account codes, including empty values,
-- so this migration does not add a foreign key from that document.
-- This migration copies no accounts.

create table if not exists finance_chart_accounts (
  company_id text not null,
  account_code text not null,
  account_name text not null,
  account_type text not null,
  normal_balance text not null,
  statutory_line text not null,
  usali_line text not null,
  active text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, account_code),
  constraint finance_chart_accounts_company_fk foreign key (company_id) references companies (id) on delete restrict,
  constraint finance_chart_accounts_code_check check (account_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  constraint finance_chart_accounts_name_check check (length(btrim(account_name)) between 1 and 200),
  constraint finance_chart_accounts_type_check check (account_type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  constraint finance_chart_accounts_balance_check check (normal_balance in ('Debit', 'Credit')),
  constraint finance_chart_accounts_statutory_check check (length(statutory_line) <= 200),
  constraint finance_chart_accounts_usali_check check (length(usali_line) <= 200),
  constraint finance_chart_accounts_active_check check (active in ('Y', 'N'))
);
