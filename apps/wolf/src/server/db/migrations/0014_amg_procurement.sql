-- AMG Finance procurement module. Safe to run again.
-- Does not create login accounts or copy finance records.

alter table finance_modules drop constraint if exists finance_modules_id_check;

alter table finance_modules add constraint finance_modules_id_check check (module_id in (
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
  'hotel-operations',
  'procurement'
));

insert into departments (company_id, id, name, status, is_demo)
select 'amg', 'procurement', 'Procurement', 'active', false
where exists (select 1 from companies where id = 'amg')
on conflict (company_id, id) do nothing;

insert into finance_modules (company_id, module_id, enabled)
select 'amg', 'procurement', 'Y'
where exists (select 1 from companies where id = 'amg')
on conflict (company_id, module_id) do nothing;
