-- Company-scoped Atrium revenue and spending documents.
-- This migration copies no documents and does not import posted journals.
-- Draft journals may now record MANUAL, REVENUE, or SPENDING sources.
-- Posting, reversal, and period locks are not represented here.

alter table atrium_draft_journals drop constraint if exists atrium_draft_journals_source_check;
alter table atrium_draft_journals add constraint atrium_draft_journals_source_check check (source_type in ('MANUAL', 'REVENUE', 'SPENDING'));

create table if not exists atrium_revenue_documents (
  company_id text not null,
  transaction_id text not null,
  journal_id text not null,
  document_date date not null,
  source text not null,
  department_code text not null,
  account_code text not null,
  amount numeric not null,
  description text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, transaction_id),
  constraint atrium_revenue_documents_journal_key unique (company_id, journal_id),
  constraint atrium_revenue_documents_company_fk foreign key (company_id) references companies (id) on delete restrict,
  constraint atrium_revenue_documents_journal_fk foreign key (company_id, journal_id) references atrium_draft_journals (company_id, journal_id) on delete restrict,
  constraint atrium_revenue_documents_account_fk foreign key (company_id, account_code) references finance_chart_accounts (company_id, account_code) on delete restrict,
  constraint atrium_revenue_documents_department_fk foreign key (company_id, department_code) references finance_operating_departments (company_id, department_code) on delete restrict,
  constraint atrium_revenue_documents_id_check check (transaction_id ~ '^rev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint atrium_revenue_documents_source_check check (source in ('Manual', 'PMS')),
  constraint atrium_revenue_documents_description_check check (length(description) <= 500),
  constraint atrium_revenue_documents_amount_check check (amount > 0 and scale(amount) <= 2)
);

create table if not exists atrium_spending_documents (
  company_id text not null,
  transaction_id text not null,
  journal_id text not null,
  document_date date not null,
  spending_type text not null,
  vendor_or_employee text not null,
  department_code text not null,
  account_code text not null,
  amount numeric not null,
  description text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, transaction_id),
  constraint atrium_spending_documents_journal_key unique (company_id, journal_id),
  constraint atrium_spending_documents_company_fk foreign key (company_id) references companies (id) on delete restrict,
  constraint atrium_spending_documents_journal_fk foreign key (company_id, journal_id) references atrium_draft_journals (company_id, journal_id) on delete restrict,
  constraint atrium_spending_documents_account_fk foreign key (company_id, account_code) references finance_chart_accounts (company_id, account_code) on delete restrict,
  constraint atrium_spending_documents_department_fk foreign key (company_id, department_code) references finance_operating_departments (company_id, department_code) on delete restrict,
  constraint atrium_spending_documents_id_check check (transaction_id ~ '^spd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint atrium_spending_documents_type_check check (spending_type in ('Procurement', 'Payroll', 'Other')),
  constraint atrium_spending_documents_vendor_check check (length(btrim(vendor_or_employee)) between 1 and 200),
  constraint atrium_spending_documents_description_check check (length(description) <= 500),
  constraint atrium_spending_documents_amount_check check (amount > 0 and scale(amount) <= 2)
);
