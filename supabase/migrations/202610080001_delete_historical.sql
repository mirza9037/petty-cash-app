begin;

-- Keep a deletion receipt while excluding historical uploads from staff reads.
alter table public.expense_reports drop constraint deleted_reports_are_drafts;
alter table public.expense_reports add constraint deleted_reports_allowed_status
  check (deleted_at is null or (status in ('draft','historical') and deleted_by is not null));

alter policy staff_items on public.expense_items using (
  exists(select 1 from public.expense_reports r where r.id=report_id and r.deleted_at is null));
alter policy staff_events on public.report_events using (
  exists(select 1 from public.expense_reports r where r.id=report_id and r.deleted_at is null));

create function public.delete_historical_report(p_report_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare staff public.profiles%rowtype; report public.expense_reports%rowtype;
begin
  select * into staff from public.profiles where id=auth.uid() and active
    and role in ('creator','hod','cfo','admin');
  if not found then raise exception 'Active staff access required to delete historical records.' using errcode='42501'; end if;
  select * into report from public.expense_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found.'; end if;
  if report.status<>'historical' then raise exception 'Only historical records can be deleted.' using errcode='40001'; end if;
  if report.deleted_at is not null then
    if report.deleted_by=auth.uid() and report.revision=p_expected_revision+1 then
      return jsonb_build_object('id',report.id,'deleted',true,'revision',report.revision);
    end if;
    raise exception 'This historical record has already been deleted.' using errcode='40001';
  end if;
  if p_expected_revision is null or report.revision<>p_expected_revision then
    raise exception 'Report changed. Reload before deleting.' using errcode='40001';
  end if;
  update public.expense_reports set deleted_at=clock_timestamp(),deleted_by=auth.uid(),
    revision=revision+1,updated_at=clock_timestamp() where id=report.id;
  return jsonb_build_object('id',report.id,'deleted',true,'revision',report.revision+1);
end $$;
revoke all on function public.delete_historical_report(uuid,integer) from public,anon,authenticated;
grant execute on function public.delete_historical_report(uuid,integer) to authenticated;

-- A retry of a previous upload cannot claim that a deleted record is still available.
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.import_historical_reports(jsonb)'::regprocedure);
  if position('results := results || jsonb_build_array(jsonb_build_object(''id'',receipt.report_id));' in definition)=0 then
    raise exception 'Unexpected historical import function';
  end if;
  execute replace(definition,
    'results := results || jsonb_build_array(jsonb_build_object(''id'',receipt.report_id));',
    'perform 1 from public.expense_reports where id=receipt.report_id for update;
     if exists(select 1 from public.expense_reports where id=receipt.report_id and deleted_at is not null) then
       raise exception ''This historical record was deleted. Remove it from the upload before retrying.'' using errcode=''40001'';
     end if;
     results := results || jsonb_build_array(jsonb_build_object(''id'',receipt.report_id));');
end $$;

commit;
