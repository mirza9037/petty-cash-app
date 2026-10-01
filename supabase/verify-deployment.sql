-- Run as the database owner through the linked CLI after migration.
-- All synthetic reports and approval events are rolled back, including on failure.
begin;
do $$
declare
  creator uuid;
  second_creator uuid;
  hod uuid;
  cfo uuid;
  test_report_id uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  saved jsonb;
  retried jsonb;
  header jsonb;
  items jsonb := '[{"description":"Deployment verification","section":"Civil Works","category":"Maintenance","amount":100.25}]';
  opening numeric;
  original_count bigint;
  denied boolean;
begin
  select id into strict creator from public.profiles where email='aftab@thi.com' and active and role='creator';
  select id into strict second_creator from public.profiles where email='idrees@thi.com' and active and role='creator';
  select id into strict hod from public.profiles where email='zeeshan@thi.com' and active and role='hod';
  select id into strict cfo from public.profiles where email='arshad@thi.com' and active and role='cfo';
  -- Keep the shared balance stable throughout this verification transaction.
  perform pg_advisory_xact_lock(20261001,1);
  select count(*) into original_count from public.expense_reports;
  perform set_config('request.jwt.claim.sub',creator::text,true);
  set local role authenticated;
  opening := coalesce((public.department_summary()->>'outstanding_balance')::numeric,0);
  header := jsonb_build_object('report_date',(now() at time zone 'Asia/Karachi')::date,
    'prev_balance',opening,'cash_received',1000,'status','draft');
  saved := public.save_expense_report(request_id,test_report_id,null,header,items);
  retried := public.save_expense_report(request_id,test_report_id,null,header,items);
  if saved is distinct from retried then raise exception 'Idempotent retry failed'; end if;
  if (saved->>'total_expenses')::numeric<>100.25 or (saved->>'outstanding_balance')::numeric<>opening+899.75 then
    raise exception 'Draft amounts do not reconcile';
  end if;
  if coalesce((public.department_summary()->>'outstanding_balance')::numeric,0)<>opening then
    raise exception 'Draft changed department balance';
  end if;
  denied := false;
  begin
    update public.expense_reports set total_expenses=0 where id=test_report_id;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Direct financial update was allowed'; end if;
  denied := false;
  begin
    update public.profiles set role='cfo' where id=creator;
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Client role escalation was allowed'; end if;
  perform set_config('request.jwt.claim.sub',second_creator::text,true);
  denied := false;
  begin
    perform public.save_expense_report(gen_random_uuid(),test_report_id,1,header,items);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Another creator could edit the draft'; end if;
  perform set_config('request.jwt.claim.sub',creator::text,true);
  items := jsonb_set(items,'{0,amount}','200.50');
  saved := public.save_expense_report(gen_random_uuid(),test_report_id,1,header,items);
  if (saved->>'revision')::integer<>2 then raise exception 'Draft revision did not advance'; end if;
  if (select total_expenses from public.expense_reports where id=test_report_id)<>200.50 then
    raise exception 'Existing total triggers broke draft editing';
  end if;
  header := jsonb_set(header,'{status}','"submitted"');
  saved := public.save_expense_report(gen_random_uuid(),test_report_id,2,header,items);
  if (public.department_summary()->>'outstanding_balance')::numeric<>opening+799.50 then
    raise exception 'Submitted department balance is incorrect';
  end if;
  denied := false;
  begin
    perform public.approve_expense_report(test_report_id,3,'cfo_approved');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Creator approval bypass was allowed'; end if;
  perform set_config('request.jwt.claim.sub',hod::text,true);
  denied := false;
  begin
    perform public.approve_expense_report(test_report_id,3,'cfo_approved');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'HOD could skip CFO approval'; end if;
  saved := public.approve_expense_report(test_report_id,3,'hod_approved');
  perform set_config('request.jwt.claim.sub',cfo::text,true);
  saved := public.approve_expense_report(test_report_id,4,'cfo_approved');
  if saved->>'status'<>'cfo_approved' or (saved->>'revision')::integer<>5
    or (saved->>'total_expenses')::numeric<>200.50 then
    raise exception 'Approval changed financial values or failed';
  end if;
  if (select count(*) from public.report_events where report_events.report_id=test_report_id)<>5 then
    raise exception 'Approval history is incomplete';
  end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if exists(select 1 from public.expense_reports) then raise exception 'Unprovisioned account could read reports'; end if;
  reset role;
  if (select count(*) from public.expense_reports)<>original_count+1 then
    raise exception 'Unexpected duplicate report';
  end if;
end $$;
rollback;
select 'Passed: draft, edit, retry, balances, ownership, permissions, HOD/CFO approvals and audit history. Test data rolled back.' as verification;
