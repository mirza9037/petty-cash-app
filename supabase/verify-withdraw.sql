begin;
do $$
declare
  creator uuid; hod uuid; cfo uuid; opening numeric; original_summary jsonb;
  submitted jsonb; approved jsonb; draft jsonb; original_count bigint; snapshot jsonb;
begin
  select id into strict creator from public.profiles where email='aftab@thi.com' and active;
  select id into strict hod from public.profiles where email='zeeshan@thi.com' and active;
  select id into strict cfo from public.profiles where email='arshad@thi.com' and active;
  perform pg_advisory_xact_lock(20261001,1);
  perform set_config('request.jwt.claim.sub',creator::text,true);
  set local role authenticated;
  original_summary := public.department_summary();
  opening := coalesce((original_summary->>'outstanding_balance')::numeric,0);
  select count(*) into original_count from public.expense_reports;
  submitted := public.save_expense_report(gen_random_uuid(),gen_random_uuid(),null,
    jsonb_build_object('report_date',(clock_timestamp() at time zone 'Asia/Karachi')::date,
      'prev_balance',opening,'cash_received',0,'status','submitted'),
    '[{"description":"Withdrawal deployment verification","section":"HVAC","category":"Maintenance","amount":0}]');
  perform set_config('request.jwt.claim.sub',hod::text,true);
  approved := public.approve_expense_report((submitted->>'id')::uuid,(submitted->>'revision')::integer,'hod_approved');
  perform set_config('request.jwt.claim.sub',cfo::text,true);
  approved := public.approve_expense_report((approved->>'id')::uuid,(approved->>'revision')::integer,'cfo_approved');
  perform set_config('request.jwt.claim.sub',creator::text,true);
  draft := public.withdraw_expense_report((approved->>'id')::uuid,(approved->>'revision')::integer);
  if draft->>'status'<>'draft' or draft->>'submitted_at' is not null then raise exception 'Withdrawal failed'; end if;
  if draft is distinct from public.withdraw_expense_report((approved->>'id')::uuid,(approved->>'revision')::integer) then raise exception 'Retry failed'; end if;
  select report_snapshot into strict snapshot from public.report_events
    where report_id=(draft->>'id')::uuid and revision=(draft->>'revision')::integer;
  if snapshot->'report'->>'status'<>'cfo_approved' or jsonb_array_length(snapshot->'items')<>1 then raise exception 'Missing submitted snapshot'; end if;
  if public.department_summary() is distinct from original_summary then raise exception 'Shared summary was not restored'; end if;
  if (select count(*) from public.expense_reports)<>original_count+1 then raise exception 'Report was deleted or duplicated'; end if;
  reset role;
end $$;
select 'Withdrawal, approved-report snapshot, retry and balance restoration passed; test records rolled back.' as result;
rollback;
