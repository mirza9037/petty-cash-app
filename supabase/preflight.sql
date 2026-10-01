-- Read-only checks to run in Supabase SQL Editor before applying the migration.
select table_name,column_name,data_type,column_default,is_nullable
from information_schema.columns
where table_schema='public' and table_name in ('expense_reports','expense_items','profiles')
order by table_name,ordinal_position;

select tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
and tablename in ('expense_reports','expense_items','profiles');

-- Review existing SECURITY DEFINER RPCs; old functions can bypass table policies.
select n.nspname as schema,p.proname as function,pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef;

-- Header/item inconsistencies must be reconciled against source receipts.
select r.id,r.status,r.submitted_by,r.total_expenses,r.outstanding_balance,
  count(i.id) as item_count,sum(i.amount) as item_total
from public.expense_reports r left join public.expense_items i on i.report_id=r.id
group by r.id
having count(i.id) not between 1 and 100
  or sum(i.amount) is distinct from r.total_expenses
  or r.outstanding_balance is distinct from r.prev_balance+r.cash_received-r.total_expenses;

select id,report_id,section,amount from public.expense_items
where amount is null or amount<0 or amount<>round(amount::numeric,2)
  or section is null or section not in ('Civil Works','HVAC','Mechanical','Carpenter','Outreach','Electrical');
