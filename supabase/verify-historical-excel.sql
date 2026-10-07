-- Real staff roles and RPCs, with every test record rolled back.
begin;
do $$
declare actor uuid; entries jsonb; ids jsonb; before_summary jsonb; after_summary jsonb;
  test_report_id uuid := gen_random_uuid(); test_request_id uuid := gen_random_uuid();
begin
  select id into actor from public.profiles where active and role in ('creator','admin') order by role limit 1;
  if actor is null then raise exception 'An active creator or administrator is required.'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  before_summary := public.department_summary();
  entries := jsonb_build_array(jsonb_build_object('request_id',test_request_id,'report_id',test_report_id,
    'header',jsonb_build_object('status','historical','report_date','2015-01-15',
      'source_reference','ROLLBACK-TEST','prev_balance',100,'cash_received',1000),
    'items',jsonb_build_array(jsonb_build_object('description','Rollback-only verification',
      'section','Civil Works','category','Maintenance','amount',100.25))));
  ids := public.import_historical_reports(entries);
  if public.import_historical_reports(entries)<>ids then raise exception 'Retry duplicated the upload.'; end if;
  after_summary := public.department_summary();
  if before_summary<>after_summary then raise exception 'Historical import changed live summaries.'; end if;
  if not exists(select 1 from public.expense_reports r where r.id=test_report_id and status='historical'
    and created_by=actor and submitted_at is null and outstanding_balance=999.75) then raise exception 'Historical amounts or ownership are incorrect.'; end if;
  if (select count(*) from public.report_events e where e.report_id=test_report_id)<>1 then
    raise exception 'Historical event count is incorrect.';
  end if;
  raise notice 'Historical upload, totals, ownership, safe retries and unchanged live summaries verified.';
end $$;
select has_function_privilege('authenticated','public.import_historical_reports(jsonb)','EXECUTE') as staff_rpc,
  has_function_privilege('anon','public.import_historical_reports(jsonb)','EXECUTE') as anon_rpc,
  has_table_privilege('authenticated','public.historical_import_requests','SELECT') as receipt_read,
  has_table_privilege('authenticated','public.expense_reports','INSERT') as direct_insert;
rollback;
