-- Company finance profile. The AMG operating system is opt-in and is not the default.
-- This file does not drop rows or import financial data.

alter table finance_settings add column if not exists workspace_kind text not null default 'shared';

alter table finance_settings drop constraint if exists finance_settings_workspace_check;
alter table finance_settings add constraint finance_settings_workspace_check check (workspace_kind in ('shared', 'amg'));
