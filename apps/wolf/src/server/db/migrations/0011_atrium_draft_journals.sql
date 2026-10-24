-- Atrium journal workbench drafts. This migration copies no journals.
-- Separate from finance_journals, whose lines reference finance_accounts.
-- Posting, reversal, and period locks are not represented here.

create table if not exists atrium_draft_journals (
  company_id text not null,
  journal_id text not null,
  journal_date date not null,
  period text not null,
  status text not null,
  source_type text not null,
  source_reference text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, journal_id),
  constraint atrium_draft_journals_company_fk foreign key (company_id) references companies (id) on delete restrict,
  constraint atrium_draft_journals_id_check check (journal_id ~ '^jrn_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint atrium_draft_journals_period_check check (period ~ '^[0-9]{4}-[0-9]{2}$' and period = to_char(journal_date, 'YYYY-MM')),
  constraint atrium_draft_journals_status_check check (status = 'DRAFT'),
  constraint atrium_draft_journals_source_check check (source_type = 'MANUAL'),
  constraint atrium_draft_journals_reference_check check (length(source_reference) <= 200),
  constraint atrium_draft_journals_created_by_check check (length(btrim(created_by)) between 1 and 200)
);

create table if not exists atrium_draft_journal_lines (
  company_id text not null,
  journal_id text not null,
  line_no integer not null,
  account_code text not null,
  department_code text,
  debit numeric not null,
  credit numeric not null,
  description text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, journal_id, line_no),
  constraint atrium_draft_journal_lines_journal_fk foreign key (company_id, journal_id) references atrium_draft_journals (company_id, journal_id) on delete cascade,
  constraint atrium_draft_journal_lines_account_fk foreign key (company_id, account_code) references finance_chart_accounts (company_id, account_code) on delete restrict,
  constraint atrium_draft_journal_lines_department_fk foreign key (company_id, department_code) references finance_operating_departments (company_id, department_code) on delete restrict,
  constraint atrium_draft_journal_lines_no_check check (line_no between 1 and 40),
  constraint atrium_draft_journal_lines_description_check check (length(description) <= 500),
  constraint atrium_draft_journal_lines_amount_check check (
    debit >= 0 and credit >= 0
    and scale(debit) <= 2 and scale(credit) <= 2
    and ((debit = 0 and credit > 0) or (credit = 0 and debit > 0))
  )
);
