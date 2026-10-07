begin;

alter table public.expense_reports add column source_reference text;
create index expense_reports_date_idx on public.expense_reports(report_date, id) where deleted_at is null;

-- Import receipts are private to the RPC. They bind retries to the original
-- actor and content without sharing the live report save request namespace.
create table public.historical_import_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  payload jsonb not null,
  report_id uuid not null unique references public.expense_reports(id)
);
alter table public.historical_import_requests enable row level security;
revoke all on public.historical_import_requests from public,anon,authenticated;

create function public.import_historical_reports(p_reports jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  staff public.profiles%rowtype;
  receipt public.historical_import_requests%rowtype;
  entry jsonb; h jsonb; item jsonb;
  import_request_id uuid; import_report_id uuid; report_day date;
  opening numeric; received numeric; expenses numeric; amount numeric;
  item_count integer; total_items integer := 0;
  results jsonb := '[]'::jsonb;
begin
  select * into staff from public.profiles where id=auth.uid() and active and role in ('creator','admin');
  if not found then raise exception 'Only active creators and administrators can upload historical records.' using errcode='42501'; end if;
  if jsonb_typeof(p_reports) is distinct from 'array' then raise exception 'Provide an array of reports.'; end if;
  if jsonb_array_length(p_reports) not between 1 and 500 then raise exception 'Upload between 1 and 500 reports at a time.'; end if;
  if exists(select 1 from jsonb_array_elements(p_reports) r group by r->>'request_id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_reports) r group by r->>'report_id' having count(*)>1) then
    raise exception 'Duplicate report or request ID in upload.';
  end if;
  -- Sorted request locks make overlapping retries serialize consistently.
  for entry in select value from jsonb_array_elements(p_reports) order by value->>'request_id' loop
    import_request_id := (entry->>'request_id')::uuid;
    import_report_id := (entry->>'report_id')::uuid;
    h := entry->'header';
    if import_request_id is null or import_report_id is null or jsonb_typeof(h) is distinct from 'object'
      or h->>'status' is distinct from 'historical' or jsonb_typeof(entry->'items') is distinct from 'array' then
      raise exception 'Historical records require report IDs, request IDs, details and expenses.';
    end if;
    item_count := jsonb_array_length(entry->'items');
    total_items := total_items+item_count;
    if total_items>10000 then raise exception 'Upload at most 10,000 expense rows at a time.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(import_request_id::text,0));
    select * into receipt from public.historical_import_requests r where r.request_id=import_request_id;
    if found then
      if receipt.actor_id<>auth.uid() or receipt.payload<>entry then raise exception 'Request ID was already used for different data.'; end if;
      results := results || jsonb_build_array(jsonb_build_object('id',receipt.report_id));
      continue;
    end if;
    if coalesce(h->>'report_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid historical report date.'; end if;
    report_day := (h->>'report_date')::date;
    if report_day>(clock_timestamp() at time zone 'Asia/Karachi')::date then raise exception 'Historical report date cannot be in the future.'; end if;
    if length(btrim(coalesce(h->>'source_reference',''))) not between 1 and 100 then raise exception 'Enter a report number of 1–100 characters.'; end if;
    if coalesce(h->>'prev_balance','') !~ '^-?\d+(\.\d{1,2})?$'
      or coalesce(h->>'cash_received','') !~ '^\d+(\.\d{1,2})?$' then raise exception 'Balances must be valid PKR amounts with at most two decimals.'; end if;
    opening := (h->>'prev_balance')::numeric;
    received := (h->>'cash_received')::numeric;
    if abs(opening)>999999999 or received>999999999 then raise exception 'Amount exceeds the supported limit.'; end if;
    if item_count not between 1 and 100 then raise exception 'Provide 1 to 100 expenses per report.'; end if;
    expenses := 0;
    for item in select value from jsonb_array_elements(entry->'items') loop
      if length(btrim(coalesce(item->>'description',''))) not between 1 and 500
        or length(btrim(coalesce(item->>'category',''))) not between 1 and 100
        or coalesce(item->>'section','') not in ('Civil Works','HVAC','Mechanical','Carpenter','Outreach','Electrical')
        or coalesce(item->>'amount','') !~ '^\d+(\.\d{1,2})?$' then raise exception 'Invalid historical expense row.'; end if;
      amount := (item->>'amount')::numeric;
      if amount>999999999 then raise exception 'Expense exceeds the supported limit.'; end if;
      expenses := expenses+amount;
    end loop;
    if expenses>999999999 or abs(opening+received-expenses)>999999999 then raise exception 'Report total or closing balance exceeds the supported limit.'; end if;
    -- Existing reports are never overwritten or promoted by an import.
    insert into public.expense_reports(id,report_date,submitted_by,hod,institution,prev_balance,cash_received,
      total_expenses,outstanding_balance,status,created_by,source_reference)
    values(import_report_id,report_day,staff.display_name,'Zeeshan Ahmed','Tabba Heart Institute',opening,received,
      expenses,opening+received-expenses,'historical',auth.uid(),btrim(h->>'source_reference'));
    insert into public.expense_items(report_id,sno,description,section,category,amount)
      select import_report_id,ordinality::integer,btrim(value->>'description'),value->>'section',btrim(value->>'category'),(value->>'amount')::numeric
      from jsonb_array_elements(entry->'items') with ordinality;
    insert into public.report_events(report_id,actor_id,actor_name,from_status,to_status,revision)
      values(import_report_id,auth.uid(),staff.display_name,null,'historical',1);
    insert into public.historical_import_requests values(import_request_id,auth.uid(),entry,import_report_id);
    results := results || jsonb_build_array(jsonb_build_object('id',import_report_id));
  end loop;
  return results;
end $$;
revoke all on function public.import_historical_reports(jsonb) from public,anon,authenticated;
grant execute on function public.import_historical_reports(jsonb) to authenticated;

create or replace function public.department_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'Staff access required.' using errcode='42501'; end if;
  select jsonb_build_object(
    'outstanding_balance',(select outstanding_balance from public.expense_reports
      where status in ('submitted','hod_approved','cfo_approved') and deleted_at is null
      order by coalesce(submitted_at,created_at) desc,id desc limit 1),
    'pending_approvals',count(*) filter(where status in ('submitted','hod_approved')),
    'month_expenses',coalesce(sum(total_expenses) filter(where status in ('submitted','hod_approved','cfo_approved')
      and report_date>=date_trunc('month',now() at time zone 'Asia/Karachi')::date
      and report_date<(date_trunc('month',now() at time zone 'Asia/Karachi')+interval '1 month')::date),0)
  ) into result from public.expense_reports where deleted_at is null;
  return result;
end $$;
commit;
