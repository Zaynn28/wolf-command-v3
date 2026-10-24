-- Company feature configuration. This does not copy financial records between companies.

create table if not exists finance_modules (
  company_id text not null,
  module_id text not null,
  enabled text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, module_id),
  constraint finance_modules_company_fk foreign key (company_id) references companies (id) on delete restrict,
  constraint finance_modules_enabled_check check (enabled in ('Y', 'N')),
  constraint finance_modules_id_check check (module_id in (
    'dashboard',
    'accounting-core',
    'reports',
    'settings',
    'atrium-workflows',
    'inventory',
    'service-charges',
    'owner-pool',
    'petty-cash',
    'tax',
    'hotel-operations'
  ))
);

insert into finance_modules (company_id, module_id, enabled)
select settings.company_id, modules.module_id,
  case
    when modules.core_module = 'Y' then 'Y'
    when settings.workspace_kind = 'amg' then 'Y'
    else 'N'
  end
from finance_settings as settings
cross join (
  values
    ('dashboard', 'Y'),
    ('accounting-core', 'Y'),
    ('reports', 'Y'),
    ('settings', 'Y'),
    ('atrium-workflows', 'N'),
    ('inventory', 'N'),
    ('service-charges', 'N'),
    ('owner-pool', 'N'),
    ('petty-cash', 'N'),
    ('tax', 'N'),
    ('hotel-operations', 'N')
) as modules(module_id, core_module)
on conflict (company_id, module_id) do nothing;
