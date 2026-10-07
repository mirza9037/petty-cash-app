begin;
alter table public.report_events add column report_snapshot jsonb;

create function public.withdraw_expense_report(p_report_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  staff public.profiles%rowtype;
  report public.expense_reports%rowtype;
  latest_id uuid;
  previous_status text;
  snapshot jsonb;
begin
  select * into staff from public.profiles where id=auth.uid() and active and role='creator';
  if not found then raise exception 'Only active creators can withdraw reports.' using errcode='42501'; end if;
  -- Match the existing save function's row-then-ledger lock order.
  select * into report from public.expense_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found.'; end if;
  if report.created_by is distinct from auth.uid() then
    raise exception 'Only the creator of this report can withdraw it.' using errcode='42501';
  end if;
  -- A retry after a lost response must not withdraw a later resubmission.
  if report.status='draft' and report.revision=p_expected_revision+1 and exists(
    select 1 from public.report_events where report_id=report.id and revision=report.revision
      and actor_id=auth.uid() and to_status='draft' and report_snapshot is not null
  ) then return to_jsonb(report); end if;
  if report.revision is distinct from p_expected_revision then
    raise exception 'Report changed. Reload before withdrawing.' using errcode='40001';
  end if;
  if report.status not in ('submitted','hod_approved','cfo_approved') then
    raise exception 'Only submitted or approved reports can be withdrawn.';
  end if;
  perform pg_advisory_xact_lock(20261001,1);
  select id into latest_id from public.expense_reports
    where status in ('submitted','hod_approved','cfo_approved')
    order by coalesce(submitted_at,created_at) desc,id desc limit 1;
  if latest_id is distinct from report.id then
    raise exception 'A later report depends on this balance. Only the latest submitted or approved report can be withdrawn.';
  end if;
  previous_status := report.status;
  snapshot := jsonb_build_object('report',to_jsonb(report),'items',(
    select coalesce(jsonb_agg(to_jsonb(i) order by i.sno),'[]'::jsonb)
    from public.expense_items i where i.report_id=report.id
  ));
  update public.expense_reports set status='draft',submitted_at=null,
    revision=revision+1,updated_at=clock_timestamp()
    where id=report.id returning * into report;
  insert into public.report_events(report_id,actor_id,actor_name,from_status,to_status,revision,report_snapshot)
    values(report.id,auth.uid(),staff.display_name,previous_status,'draft',report.revision,snapshot);
  return to_jsonb(report);
end $$;
revoke all on function public.withdraw_expense_report(uuid,integer) from public,anon,authenticated;
grant execute on function public.withdraw_expense_report(uuid,integer) to authenticated;
commit;
