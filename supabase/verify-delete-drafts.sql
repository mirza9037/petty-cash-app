-- Verify against the linked database without leaving test records.
begin;
do $$
declare creator uuid; administrator uuid; report jsonb; removed jsonb;
  request_id uuid := gen_random_uuid(); task_report_id uuid := gen_random_uuid();
  header jsonb := jsonb_build_object('report_date',(clock_timestamp() at time zone 'Asia/Karachi')::date,'prev_balance',0,'cash_received',0,'status','draft');
  lines jsonb := '[{"description":"Deletion verification","section":"HVAC","category":"Maintenance","amount":0}]';
begin
  select id into strict creator from public.profiles where email='aftab@thi.com' and active;
  select id into strict administrator from public.profiles where email='admin@tabbaheart.org' and role='admin' and active;
  perform set_config('request.jwt.claim.sub',creator::text,true);
  set local role authenticated;
  report := public.save_expense_report(request_id,task_report_id,null,header,lines);
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  removed := public.delete_draft_report(task_report_id,(report->>'revision')::integer);
  if removed->>'deleted'<>'true' then raise exception 'Deletion failed'; end if;
  if public.delete_draft_report(task_report_id,(report->>'revision')::integer)<>removed then raise exception 'Retry failed'; end if;
  if exists(select 1 from public.expense_reports where id=task_report_id)
    or exists(select 1 from public.expense_items where expense_items.report_id=task_report_id)
    or exists(select 1 from public.report_events where report_events.report_id=task_report_id)
    then raise exception 'Deleted data remains visible'; end if;
  perform set_config('request.jwt.claim.sub',creator::text,true);
  if public.resolve_report_save(request_id,false)->>'status'<>'cancelled' then raise exception 'Recovery failed'; end if;
  begin
    perform public.save_expense_report(request_id,task_report_id,null,header,lines);
    raise exception 'Deleted save accepted';
  exception when serialization_failure then null;
  end;
  reset role;
  if not exists(select 1 from public.expense_reports r where r.id=task_report_id and r.deleted_by=administrator and r.deleted_at is not null)
    then raise exception 'Deletion attribution missing'; end if;
end $$;
rollback;

