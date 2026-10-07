-- Temporary report changes are rolled back; the existing administrator profile is retained.
begin;
do $$
declare
  administrator uuid; creator uuid; opening numeric; initial_summary jsonb;
  report jsonb; request_id uuid := gen_random_uuid();
  header jsonb; lines jsonb := '[{"description":"Administrator verification","section":"HVAC","category":"Maintenance","amount":0}]';
begin
  select id into strict administrator from public.profiles where email='admin@tabbaheart.org' and role='admin' and active;
  select id into strict creator from public.profiles where email='aftab@thi.com' and active;
  perform pg_advisory_xact_lock(20261001,1);
  perform set_config('request.jwt.claim.sub',creator::text,true);
  set local role authenticated;
  initial_summary := public.department_summary();
  opening := coalesce((initial_summary->>'outstanding_balance')::numeric,0);
  header := jsonb_build_object('report_date',(clock_timestamp() at time zone 'Asia/Karachi')::date,'prev_balance',opening,'cash_received',0,'status','draft');
  report := public.save_expense_report(gen_random_uuid(),gen_random_uuid(),null,header,lines);
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  report := public.save_expense_report(request_id,(report->>'id')::uuid,(report->>'revision')::integer,jsonb_set(header,'{status}','"submitted"'),lines);
  if report->>'created_by'<>creator::text then raise exception 'Administrator changed ownership'; end if;
  if public.resolve_report_save(request_id,false)->>'report_id'<>report->>'id' then raise exception 'Administrator recovery failed'; end if;
  report := public.approve_expense_report((report->>'id')::uuid,(report->>'revision')::integer,'hod_approved');
  report := public.approve_expense_report((report->>'id')::uuid,(report->>'revision')::integer,'cfo_approved');
  report := public.withdraw_expense_report((report->>'id')::uuid,(report->>'revision')::integer);
  if report->>'status'<>'draft' then raise exception 'Administrator withdrawal failed'; end if;
  if public.department_summary()->'outstanding_balance' is distinct from initial_summary->'outstanding_balance' then raise exception 'Balance was not restored'; end if;
  report := public.save_expense_report(gen_random_uuid(),gen_random_uuid(),null,header,lines);
  if report->>'created_by'<>administrator::text then raise exception 'Administrator creation failed'; end if;
  perform public.import_expense_reports(jsonb_build_array(jsonb_build_object('request_id',gen_random_uuid(),'report_id',gen_random_uuid(),'header',header,'items',lines)));
  reset role;
end $$;
select 'Administrator create, edit, import, recovery, HOD approval, CFO approval and withdrawal passed. Test records rolled back.' as result;
rollback;
