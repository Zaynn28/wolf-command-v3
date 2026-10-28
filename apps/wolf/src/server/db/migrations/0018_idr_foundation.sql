-- Books are IDR. This update changes only currency_code and minor_scale.
-- It does not rewrite journals, mappings, drafts, or any other column.
-- Configurable tables below are empty. No tax rates, outlets, or account codes are inserted.
-- Row level security stays disabled.

update finance_settings
set currency_code = 'IDR',
    minor_scale = 0
where currency_code is distinct from 'IDR'
   or minor_scale is distinct from 0;

alter table finance_settings add column if not exists rounding_mode text not null default 'half-up';

alter table finance_settings drop constraint if exists finance_settings_idr_check;
alter table finance_settings add constraint finance_settings_idr_check check (currency_code = 'IDR' and minor_scale = 0);

alter table finance_settings drop constraint if exists finance_settings_rounding_check;
alter table finance_settings add constraint finance_settings_rounding_check check (rounding_mode in ('half-up', 'half-even', 'down'));

create table if not exists finance_outlets (
  company_id text not null references companies (id) on delete restrict,
  outlet_id text not null,
  outlet_code text not null,
  outlet_name text not null,
  active text not null default 'Y',
  created_at timestamptz not null default now(),
  primary key (company_id, outlet_id),
  unique (company_id, outlet_code),
  constraint finance_outlets_code_check check (outlet_code ~ '^[A-Z0-9][A-Z0-9-]{0,30}$'),
  constraint finance_outlets_name_check check (length(btrim(outlet_name)) between 1 and 120),
  constraint finance_outlets_active_check check (active in ('Y', 'N'))
);

create table if not exists finance_tax_rates (
  company_id text not null references companies (id) on delete restrict,
  rate_id text not null,
  outlet_id text,
  tax_type text not null,
  rate_ppm integer not null,
  price_mode text not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  primary key (company_id, rate_id),
  constraint finance_tax_rates_type_check check (tax_type in ('PB1', 'PPN', 'SERVICE', 'PPh')),
  constraint finance_tax_rates_ppm_check check (rate_ppm between 0 and 1000000),
  constraint finance_tax_rates_mode_check check (price_mode in ('exclusive', 'inclusive')),
  constraint finance_tax_rates_window_check check (effective_to is null or effective_to >= effective_from)
);

create table if not exists finance_uom_conversions (
  company_id text not null references companies (id) on delete restrict,
  item_code text not null,
  from_uom text not null,
  to_uom text not null,
  factor_ppm bigint not null,
  effective_from date not null,
  primary key (company_id, item_code, from_uom, to_uom, effective_from),
  constraint finance_uom_base_check check (to_uom in ('g', 'ml', 'pcs')),
  constraint finance_uom_factor_check check (factor_ppm > 0)
);

create table if not exists finance_locations (
  company_id text not null references companies (id) on delete restrict,
  outlet_id text not null,
  location_id text not null,
  location_code text not null,
  location_name text not null,
  kind text not null,
  primary key (company_id, location_id),
  unique (company_id, outlet_id, location_code),
  constraint finance_locations_kind_check check (kind in ('store', 'in-transit'))
);

create table if not exists finance_stock_ledger (
  company_id text not null references companies (id) on delete restrict,
  entry_id text not null,
  outlet_id text not null,
  location_id text not null,
  item_code text not null,
  qty_in_base bigint not null,
  qty_out_base bigint not null,
  unit_cost_internal bigint not null,
  document_ref text not null,
  created_by uuid references users (id) on delete restrict,
  created_at timestamptz not null,
  primary key (company_id, entry_id),
  constraint finance_stock_ledger_qty_check check (
    qty_in_base >= 0
    and qty_out_base >= 0
    and (qty_in_base = 0 or qty_out_base = 0)
    and (qty_in_base > 0 or qty_out_base > 0)
  ),
  constraint finance_stock_ledger_cost_check check (unit_cost_internal >= 0)
);

create or replace function finance_stock_ledger_block()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock ledger rows are append-only';
end;
$$;

drop trigger if exists finance_stock_ledger_no_change on finance_stock_ledger;
create trigger finance_stock_ledger_no_change
before update or delete on finance_stock_ledger
for each row execute function finance_stock_ledger_block();

create table if not exists finance_stock_transfers (
  company_id text not null references companies (id) on delete restrict,
  transfer_id text not null,
  outlet_id text not null,
  from_location_id text not null,
  to_location_id text not null,
  transit_location_id text not null,
  item_code text not null,
  qty_base bigint not null,
  status text not null,
  primary key (company_id, transfer_id),
  constraint finance_stock_transfers_status_check check (status in ('sent', 'received')),
  constraint finance_stock_transfers_qty_check check (qty_base > 0)
);

create table if not exists finance_posting_rules (
  company_id text not null references companies (id) on delete restrict,
  rule_id text not null,
  event_code text not null,
  category_code text not null,
  outlet_id text,
  debit_account_code text not null,
  credit_account_code text not null,
  primary key (company_id, rule_id),
  constraint finance_posting_rules_accounts_check check (
    length(btrim(debit_account_code)) > 0
    and length(btrim(credit_account_code)) > 0
    and debit_account_code <> credit_account_code
  )
);

create table if not exists finance_rule_journals (
  company_id text not null references companies (id) on delete restrict,
  journal_id text not null,
  document_ref text not null,
  event_code text not null,
  debit_units bigint not null,
  credit_units bigint not null,
  created_at timestamptz not null,
  primary key (company_id, journal_id),
  unique (company_id, document_ref),
  constraint finance_rule_journals_balance_check check (debit_units = credit_units and debit_units >= 0)
);

create table if not exists finance_rule_journal_lines (
  company_id text not null references companies (id) on delete restrict,
  journal_id text not null,
  line_no integer not null,
  account_code text not null,
  side text not null,
  amount_units bigint not null,
  primary key (company_id, journal_id, line_no),
  constraint finance_rule_journal_lines_side_check check (side in ('debit', 'credit')),
  constraint finance_rule_journal_lines_amount_check check (amount_units >= 0)
);

create table if not exists finance_approval_rules (
  company_id text not null references companies (id) on delete restrict,
  rule_id text not null,
  document_type text not null,
  threshold_units bigint not null,
  approver_role text not null,
  primary key (company_id, rule_id),
  constraint finance_approval_rules_role_check check (approver_role in ('staff', 'administrator', 'owner')),
  constraint finance_approval_rules_threshold_check check (threshold_units >= 0)
);

create table if not exists finance_attachments (
  company_id text not null references companies (id) on delete restrict,
  attachment_id text not null,
  document_ref text not null,
  file_name text not null,
  created_at timestamptz not null,
  primary key (company_id, attachment_id),
  constraint finance_attachments_name_check check (length(btrim(file_name)) between 1 and 180)
);
