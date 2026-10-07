begin;

-- Keep financial history and stable IDs after removing a draft from active use.
alter table public.expense_reports add column deleted_at timestamptz;
alter table public.expense_reports add column deleted_by uuid references auth.users(id);
alter table public.expense_reports add constraint deleted_reports_are_drafts
  check (deleted_at is null or (status='draft' and deleted_by is not null));

alter policy staff_reports on public.expense_reports using (
  deleted_at is null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));
alter policy staff_items on public.expense_items using (
  exists(select 1 from public.expense_reports r where r.id=report_id));
alter policy staff_events on public.report_events using (
  exists(select 1 from public.expense_reports r where r.id=report_id));

create function public.delete_draft_report(p_report_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare staff public.profiles%rowtype; report public.expense_reports%rowtype;
begin
  select * into staff from public.profiles where id=auth.uid() and active and role in ('creator','admin');
  if not found then raise exception 'Only active creators and administrators can delete drafts.' using errcode='42501'; end if;
  select * into report from public.expense_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found.'; end if;
  if staff.role<>'admin' and report.created_by is distinct from auth.uid() then
    raise exception 'This draft belongs to another account.' using errcode='42501';
  end if;
  if report.deleted_at is not null then
    if report.deleted_by=auth.uid() and report.revision=p_expected_revision+1 then
      return jsonb_build_object('id',report.id,'deleted',true,'revision',report.revision);
    end if;
    raise exception 'This draft has already been deleted.' using errcode='40001';
  end if;
  if p_expected_revision is null or report.revision<>p_expected_revision or report.status<>'draft' then
    raise exception 'Report changed or was submitted. Reload before deleting.' using errcode='40001';
  end if;
  update public.expense_reports set deleted_at=clock_timestamp(),deleted_by=auth.uid(),
    revision=revision+1,updated_at=clock_timestamp() where id=report.id;
  return jsonb_build_object('id',report.id,'deleted',true,'revision',report.revision+1);
end $$;
revoke all on function public.delete_draft_report(uuid,integer) from public,anon,authenticated;
grant execute on function public.delete_draft_report(uuid,integer) to authenticated;

-- Guard every existing mutation, including draft edits and withdrawal retries.
create function public.guard_deleted_report() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.deleted_at is not null then raise exception 'This draft has been deleted.' using errcode='40001'; end if;
  return new;
end $$;
create trigger protect_deleted_report before update on public.expense_reports
for each row execute function public.guard_deleted_report();

-- A cached successful save must never report a deleted draft as imported/saved.
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.save_expense_report(uuid,uuid,integer,jsonb,jsonb)'::regprocedure);
  if position('return prior.result;' in definition)=0 then raise exception 'Unexpected save function'; end if;
  execute replace(definition,'return prior.result;',
    'perform 1 from public.expense_reports where id=(prior.result->>''id'')::uuid and deleted_at is not null for update;
     if found then raise exception ''This draft has been deleted. Use a new report or template key.'' using errcode=''40001''; end if;
     return prior.result;');
  definition := pg_get_functiondef('public.resolve_report_save(uuid,boolean)'::regprocedure);
  if position('if prior.result->>''cancelled''=''true'' then' in definition)=0 then raise exception 'Unexpected recovery function'; end if;
  execute replace(definition,'if prior.result->>''cancelled''=''true'' then',
    'if prior.result->>''cancelled''=''true'' or exists(select 1 from public.expense_reports where id=(prior.result->>''id'')::uuid and deleted_at is not null) then');
  definition := pg_get_functiondef('public.withdraw_expense_report(uuid,integer)'::regprocedure);
  if position('if report.status=''draft''' in definition)=0 then raise exception 'Unexpected withdrawal function'; end if;
  execute replace(definition,'if report.status=''draft''',
    'if report.deleted_at is not null then raise exception ''This draft has been deleted.'' using errcode=''40001''; end if;
     if report.status=''draft''');
end $$;
commit;
