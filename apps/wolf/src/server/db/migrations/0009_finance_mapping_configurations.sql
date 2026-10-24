-- One account-mapping document per company. This migration copies no configuration.

create table if not exists finance_mapping_configurations (
  company_id text not null,
  revenue_default_debit_account text not null,
  spending_procurement_credit_account text not null,
  spending_payroll_credit_account text not null,
  spending_other_credit_account text not null,
  confirmed_by_controller boolean not null,
  updated_at timestamptz not null default now(),
  primary key (company_id),
  constraint finance_mapping_configurations_company_fk foreign key (company_id) references companies (id) on delete restrict,
  constraint finance_mapping_configurations_accounts_check check (
    revenue_default_debit_account ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
    and spending_procurement_credit_account ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
    and spending_payroll_credit_account ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
    and spending_other_credit_account ~ '^$|^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'
  )
);
