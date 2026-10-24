-- Same Finance feature set for AMG, BZG, and GGV. This changes configuration only.

update finance_modules
set enabled = 'Y', updated_at = now()
where company_id in ('amg', 'bzg', 'ggv')
  and module_id in (
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
  );
