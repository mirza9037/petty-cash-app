-- Run through the linked CLI as database owner. No test records are retained.
begin;
do $$
declare
  creator uuid; approver uuid; baseline bigint; entries jsonb; first_result jsonb;
  bad jsonb; rejected boolean := false;
begin
  select id into strict creator from public.profiles where email='aftab@thi.com' and active and role='creator';
  select id into strict approver from public.profiles where email='zeeshan@thi.com' and active and role='hod';
  perform set_config('request.jwt.claim.sub',creator::text,true);
  set local role authenticated;
  select count(*) into baseline from public.expense_reports;
  entries := jsonb_build_array(jsonb_build_object(
    'request_id',gen_random_uuid(),'report_id',gen_random_uuid(),
    'header',jsonb_build_object('report_date','2026-10-01','prev_balance',0,'cash_received',100,'status','draft'),
    'items',jsonb_build_array(jsonb_build_object('description','Excel deployment verification','section','HVAC','category','Maintenance','amount',1.25))
  ));
  first_result := public.import_expense_reports(entries);
  if first_result is distinct from public.import_expense_reports(entries) then raise exception 'Retry changed result'; end if;
  if (select count(*) from public.expense_reports) <> baseline+1 then raise exception 'Duplicate or missing import'; end if;
  if not exists(select 1 from public.expense_reports where id=(first_result->0->>'id')::uuid
    and created_by=creator and status='draft' and total_expenses=1.25 and outstanding_balance=98.75) then
    raise exception 'Invalid imported financial fields or ownership';
  end if;
  bad := jsonb_set(entries,'{0,request_id}',to_jsonb(gen_random_uuid()));
  bad := jsonb_set(bad,'{0,report_id}',to_jsonb(gen_random_uuid()));
  bad := bad || jsonb_build_array(jsonb_build_object('request_id',gen_random_uuid(),'report_id',gen_random_uuid(),
    'header',entries->0->'header','items','[]'::jsonb));
  begin
    perform public.import_expense_reports(bad);
  exception when others then rejected := true;
  end;
  if not rejected or (select count(*) from public.expense_reports) <> baseline+1 then raise exception 'Import did not roll back'; end if;
  perform set_config('request.jwt.claim.sub',approver::text,true);
  rejected := false;
  begin
    perform public.import_expense_reports(entries);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Approver could import'; end if;
  reset role;
  raise notice 'Excel verification passed: draft import, totals, ownership, retry, rollback and role checks.';
end $$;
rollback;
