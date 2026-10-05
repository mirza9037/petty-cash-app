begin;

create or replace function public.save_expense_report(
  p_request_id uuid, p_report_id uuid, p_expected_revision integer,
  p_header jsonb, p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  staff public.profiles%rowtype;
  existing public.expense_reports%rowtype;
  saved public.expense_reports%rowtype;
  prior public.report_save_requests%rowtype;
  payload jsonb;
  item jsonb;
  amount numeric;
  expenses numeric := 0;
  opening numeric;
  received numeric;
  latest numeric;
  latest_date date;
  report_day date;
  target_status text;
  item_no integer := 0;
begin
  select * into staff from public.profiles where id=auth.uid() and active and role='creator';
  if not found then raise exception 'Only active creators can save reports.' using errcode='42501'; end if;
  if p_request_id is null then raise exception 'A request ID is required.'; end if;
  payload := jsonb_build_object('report_id',p_report_id,'revision',p_expected_revision,'header',p_header,'items',p_items);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from public.report_save_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>auth.uid() or prior.payload<>payload then raise exception 'Request ID was already used for different data.'; end if;
    return prior.result;
  end if;
  if jsonb_typeof(p_header) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Report and line items are required.';
  end if;
  target_status := p_header->>'status';
  if target_status is null or target_status not in ('draft','submitted') then raise exception 'Invalid initial report status.'; end if;
  if coalesce(p_header->>'report_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid report date.'; end if;
  report_day := (p_header->>'report_date')::date;
  if target_status='submitted' and report_day>(clock_timestamp() at time zone 'Asia/Karachi')::date then
    raise exception 'Submitted report date cannot be in the future (Karachi time).';
  end if;
  if coalesce(p_header->>'prev_balance','') !~ '^-?\d+(\.\d{1,2})?$'
    or coalesce(p_header->>'cash_received','') !~ '^\d+(\.\d{1,2})?$' then
    raise exception 'Balances must be valid amounts with at most two decimals.';
  end if;
  opening := (p_header->>'prev_balance')::numeric;
  received := (p_header->>'cash_received')::numeric;
  if abs(opening)>999999999 or received>999999999 then raise exception 'Amount exceeds the supported limit.'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Provide 1 to 100 line items.'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    item_no := item_no+1;
    if length(btrim(coalesce(item->>'description',''))) not between 1 and 500
      or length(btrim(coalesce(item->>'category',''))) not between 1 and 100
      or coalesce(item->>'section','') not in ('Civil Works','HVAC','Mechanical','Carpenter','Outreach','Electrical')
      or coalesce(item->>'amount','') !~ '^\d+(\.\d{1,2})?$' then
      raise exception 'Invalid description, category, section or amount on row %.',item_no;
    end if;
    amount := (item->>'amount')::numeric;
    if amount>999999999 then raise exception 'Amount on row % exceeds the supported limit.',item_no; end if;
    expenses := expenses+amount;
  end loop;
  if expenses>999999999 then raise exception 'Report total exceeds the supported limit.'; end if;
  if abs(opening+received-expenses)>999999999 then raise exception 'Closing balance exceeds the supported limit.'; end if;
  if p_report_id is not null then
    select * into existing from public.expense_reports where id=p_report_id for update;
    if found and existing.created_by is distinct from auth.uid() then raise exception 'This draft is not owned by your account.' using errcode='42501'; end if;
    if (existing.id is null and p_expected_revision is not null) or
      (existing.id is not null and (existing.status<>'draft' or existing.revision is distinct from p_expected_revision)) then
      raise exception 'Report changed or was submitted. Reload before saving.' using errcode='40001';
    end if;
  end if;
  if target_status='submitted' then
    -- Both creators share one department cash account.
    perform pg_advisory_xact_lock(20261001,1);
    select outstanding_balance,report_date into latest,latest_date from public.expense_reports
      where status in ('submitted','hod_approved','cfo_approved')
      order by coalesce(submitted_at,created_at) desc,id desc limit 1;
    if found then
      if opening<>latest then raise exception 'Department balance changed. Refresh the opening balance before submitting.' using errcode='40001'; end if;
      if report_day<latest_date then raise exception 'Report date cannot precede the latest submitted report.'; end if;
    end if;
  end if;
  if existing.id is null then
    insert into public.expense_reports(id,report_date,submitted_by,hod,institution,prev_balance,cash_received,
      total_expenses,outstanding_balance,status,created_by,submitted_at)
    values(coalesce(p_report_id,gen_random_uuid()),report_day,staff.display_name,'Zeeshan Ahmed','Tabba Heart Institute',opening,received,
      expenses,opening+received-expenses,target_status,auth.uid(),case when target_status='submitted' then clock_timestamp() end)
    returning * into saved;
  else
    update public.expense_reports set report_date=report_day,prev_balance=opening,cash_received=received,
      total_expenses=expenses,outstanding_balance=opening+received-expenses,status=target_status,
      revision=revision+1,updated_at=clock_timestamp(),
      submitted_at=case when target_status='submitted' then clock_timestamp() end
      where id=p_report_id returning * into saved;
    delete from public.expense_items where report_id=p_report_id;
  end if;
  insert into public.expense_items(report_id,sno,description,section,category,amount)
    select saved.id,ordinality::integer,btrim(value->>'description'),value->>'section',btrim(value->>'category'),(value->>'amount')::numeric
    from jsonb_array_elements(p_items) with ordinality;
  insert into public.report_events(report_id,actor_id,actor_name,from_status,to_status,revision)
    values(saved.id,auth.uid(),staff.display_name,existing.status,saved.status,saved.revision);
  insert into public.report_save_requests(request_id,actor_id,payload,result)
    values(p_request_id,auth.uid(),payload,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create function public.resolve_report_save(p_request_id uuid, p_discard boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.report_save_requests%rowtype;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='creator') then
    raise exception 'Only active creators can resolve saves.' using errcode='42501';
  end if;
  if p_request_id is null then raise exception 'A request ID is required.'; end if;
  -- Serialize with the original save. A cancellation also blocks a late retry.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from public.report_save_requests where request_id=p_request_id;
  if found then
    if prior.actor_id<>auth.uid() then raise exception 'This request is not owned by your account.' using errcode='42501'; end if;
    if prior.result->>'cancelled'='true' then return jsonb_build_object('status','cancelled'); end if;
    return jsonb_build_object('status','saved','report_id',prior.result->>'id');
  end if;
  if p_discard then
    insert into public.report_save_requests(request_id,actor_id,payload,result)
      values(p_request_id,auth.uid(),'{"cancelled":true}','{"cancelled":true}');
    return jsonb_build_object('status','cancelled');
  end if;
  return jsonb_build_object('status','unknown');
end $$;
revoke all on function public.resolve_report_save(uuid,boolean) from public,anon,authenticated;
grant execute on function public.resolve_report_save(uuid,boolean) to authenticated;

commit;
