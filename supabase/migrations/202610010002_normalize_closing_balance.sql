-- Older installations may have a generated closing-balance column. The atomic
-- save function supplies this value itself, so retain the values as a normal
-- numeric column. Client writes remain revoked by the preceding migration.
begin;
alter table public.expense_reports
  alter column outstanding_balance drop expression if exists;
commit;
