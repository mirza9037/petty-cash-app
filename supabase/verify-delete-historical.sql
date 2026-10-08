-- Rollback-only verification against the linked project.
begin;
do $$
declare uploader uuid; deleter uuid; entries jsonb; removed jsonb; before_summary jsonb;
  test_report_id uuid := gen_random_uuid(); test_request_id uuid := gen_random_uuid();
begin
  select id into strict uploader from public.profiles where active and role in ('creator','admin')
    order by case when role='creator' then 0 else 1 end limit 1;
  select id into strict deleter from public.profiles where active and role in ('hod','cfo','admin')
    order by case role when 'hod' then 0 when 'cfo' then 1 else 2 end limit 1;
  perform set_config('request.jwt.claim.sub',uploader::text,true);
  set local role authenticated;
  before_summary := public.department_summary();
  entries := jsonb_build_array(jsonb_build_object('request_id',test_request_id,'report_id',test_report_id,
    'header',jsonb_build_object('status','historical','report_date','2015-01-15',
      'source_reference','DELETE-ROLLBACK-TEST','prev_balance',0,'cash_received',100),
    'items',jsonb_build_array(jsonb_build_object('description','Deletion verification',
      'section','Civil Works','category','Maintenance','amount',25))));
  perform public.import_historical_reports(entries);
  perform set_config('request.jwt.claim.sub',deleter::text,true);
  removed := public.delete_historical_report(test_report_id,1);
  if removed->>'deleted'<>'true' or (removed->>'revision')::integer<>2 then raise exception 'Historical deletion failed'; end if;
  if public.delete_historical_report(test_report_id,1)<>removed then raise exception 'Historical deletion retry failed'; end if;
  if exists(select 1 from public.expense_reports where id=test_report_id)
    or exists(select 1 from public.expense_items where report_id=test_report_id)
    or exists(select 1 from public.report_events where report_id=test_report_id)
    then raise exception 'Deleted history remains visible'; end if;
  if public.department_summary()<>before_summary then raise exception 'Historical deletion changed the live balance'; end if;
  perform set_config('request.jwt.claim.sub',uploader::text,true);
  begin
    perform public.import_historical_reports(entries);
    raise exception 'Deleted upload retry was accepted';
  exception when serialization_failure then null;
  end;
  reset role;
  if not exists(select 1 from public.expense_reports where id=test_report_id and deleted_by=deleter and deleted_at is not null)
    then raise exception 'Deletion receipt was not retained'; end if;
end $$;
select has_function_privilege('authenticated','public.delete_historical_report(uuid,integer)','EXECUTE') as staff_rpc,
  has_function_privilege('anon','public.delete_historical_report(uuid,integer)','EXECUTE') as anon_rpc,
  has_table_privilege('authenticated','public.expense_reports','UPDATE') as direct_update;
rollback;
