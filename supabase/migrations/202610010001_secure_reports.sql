-- Apply once as the database owner, before deploying the matching frontend.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  email text not null,
  role text not null check (role in ('creator','hod','cfo')),
  display_name text not null
);
alter table public.profiles add column if not exists active boolean not null default true;

create table if not exists public.expense_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  submitted_by text not null,
  hod text not null,
  institution text not null,
  prev_balance numeric not null,
  cash_received numeric not null,
  total_expenses numeric not null,
  outstanding_balance numeric not null,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
alter table public.expense_reports add column if not exists created_by uuid references auth.users(id);
alter table public.expense_reports add column if not exists revision integer not null default 1;
alter table public.expense_reports add column if not exists submitted_at timestamptz;
alter table public.expense_reports add column if not exists updated_at timestamptz not null default now();

create table if not exists public.expense_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.expense_reports(id),
  sno integer not null,
  description text not null,
  section text not null,
  category text not null,
  amount numeric not null
);
create index if not exists expense_items_report_idx on public.expense_items(report_id, sno);
create index if not exists expense_reports_created_idx on public.expense_reports(created_at desc, id);
create index if not exists expense_reports_owner_idx on public.expense_reports(created_by);

create table public.report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.expense_reports(id),
  actor_id uuid not null references auth.users(id),
  actor_name text not null,
  from_status text,
  to_status text not null,
  revision integer not null,
  created_at timestamptz not null default clock_timestamp()
);
create index report_events_report_idx on public.report_events(report_id, created_at);
create table public.report_save_requests (
  request_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- Existing submitter names are not proof of ownership. Legacy ownership is
-- intentionally left NULL until an administrator reconciles the records.
insert into public.profiles(id,email,role,display_name)
select u.id,u.email,s.role,s.name from auth.users u join
  (values ('aftab@thi.com','creator','Aftab Ahmed'),
          ('idrees@thi.com','creator','Idrees'),
          ('zeeshan@thi.com','hod','Zeeshan Ahmed'),
          ('arshad@thi.com','cfo','Arshad Ghaffar')) s(email,role,name)
  on lower(u.email)=s.email
on conflict(id) do nothing;

-- Remove prior permissive policies, including policies outside the old guide.
do $$ declare p record; begin
  for p in select tablename,policyname from pg_policies
    where schemaname='public' and tablename in
      ('profiles','expense_reports','expense_items','report_events','report_save_requests')
  loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.expense_reports enable row level security;
alter table public.expense_items enable row level security;
alter table public.report_events enable row level security;
alter table public.report_save_requests enable row level security;
revoke all on public.profiles, public.expense_reports, public.expense_items,
  public.report_events, public.report_save_requests from public, anon, authenticated;
grant select on public.profiles, public.expense_reports, public.expense_items,
  public.report_events to authenticated;

create policy own_profile on public.profiles for select to authenticated
  using (id=auth.uid());
create policy staff_reports on public.expense_reports for select to authenticated
  using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));
create policy staff_items on public.expense_items for select to authenticated
  using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));
create policy staff_events on public.report_events for select to authenticated
  using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));

create function public.save_expense_report(
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

create function public.approve_expense_report(p_report_id uuid,p_expected_revision integer,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare staff public.profiles%rowtype; report public.expense_reports%rowtype; previous text;
begin
  select * into staff from public.profiles where id=auth.uid() and active;
  if not found then raise exception 'Staff access required.' using errcode='42501'; end if;
  select * into report from public.expense_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found.'; end if;
  if report.revision is distinct from p_expected_revision then raise exception 'Report changed. Reload before approving.' using errcode='40001'; end if;
  if not ((staff.role='hod' and report.status='submitted' and p_status='hod_approved')
      or (staff.role='cfo' and report.status='hod_approved' and p_status='cfo_approved')) or p_status is null then
    raise exception 'This approval transition is not permitted.' using errcode='42501';
  end if;
  if report.created_by is null then raise exception 'Legacy report requires ownership reconciliation before approval.'; end if;
  if (select count(*) from public.expense_items where report_id=report.id) not between 1 and 100
    or exists(select 1 from public.expense_items where report_id=report.id and (
      amount is null or amount<0 or amount>999999999 or amount<>round(amount,2)
      or section is null or section not in ('Civil Works','HVAC','Mechanical','Carpenter','Outreach','Electrical')
      or length(btrim(coalesce(description,''))) not between 1 and 500
      or length(btrim(coalesce(category,''))) not between 1 and 100))
    or (select sum(amount) from public.expense_items where report_id=report.id) is distinct from report.total_expenses
    or report.outstanding_balance is distinct from report.prev_balance+report.cash_received-report.total_expenses then
    raise exception 'Report amounts do not reconcile. Administrator review is required.';
  end if;
  previous := report.status;
  update public.expense_reports set status=p_status,revision=revision+1,updated_at=clock_timestamp()
    where id=p_report_id returning * into report;
  insert into public.report_events(report_id,actor_id,actor_name,from_status,to_status,revision)
    values(report.id,auth.uid(),staff.display_name,previous,report.status,report.revision);
  return to_jsonb(report);
end $$;

create function public.department_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'Staff access required.' using errcode='42501'; end if;
  select jsonb_build_object(
    'outstanding_balance',(select outstanding_balance from public.expense_reports
      where status in ('submitted','hod_approved','cfo_approved')
      order by coalesce(submitted_at,created_at) desc,id desc limit 1),
    'pending_approvals',count(*) filter(where status in ('submitted','hod_approved')),
    'month_expenses',coalesce(sum(total_expenses) filter(where status<>'draft'
      and report_date>=date_trunc('month',now() at time zone 'Asia/Karachi')::date
      and report_date<(date_trunc('month',now() at time zone 'Asia/Karachi')+interval '1 month')::date),0)
  ) into result from public.expense_reports;
  return result;
end $$;

revoke all on function public.save_expense_report(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.approve_expense_report(uuid,integer,text) from public,anon,authenticated;
revoke all on function public.department_summary() from public,anon,authenticated;
grant execute on function public.save_expense_report(uuid,uuid,integer,jsonb,jsonb) to authenticated;
grant execute on function public.approve_expense_report(uuid,integer,text) to authenticated;
grant execute on function public.department_summary() to authenticated;
commit;
