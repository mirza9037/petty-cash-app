-- A workbook is one transaction. Reuse the existing creator checks, validation,
-- audit trail and idempotency instead of granting direct table writes.
create function public.import_expense_reports(p_reports jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare entry jsonb; saved jsonb; results jsonb := '[]'::jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='creator') then
    raise exception 'Only active creators can import reports.' using errcode='42501';
  end if;
  if jsonb_typeof(p_reports) is distinct from 'array' then
    raise exception 'Provide an array of reports.';
  end if;
  if jsonb_array_length(p_reports) not between 1 and 50 then
    raise exception 'Import between 1 and 50 reports at a time.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_reports) r group by r->>'request_id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_reports) r group by r->>'report_id' having count(*)>1) then
    raise exception 'Duplicate report or request ID in import.';
  end if;
  -- Consistent lock order for overlapping concurrent retries.
  for entry in select value from jsonb_array_elements(p_reports) order by value->>'request_id' loop
    if entry->>'report_id' is null or entry->>'request_id' is null
      or entry->'header'->>'status' is distinct from 'draft' then
      raise exception 'Imports must create drafts with report and request IDs.';
    end if;
    saved := public.save_expense_report(
      (entry->>'request_id')::uuid, (entry->>'report_id')::uuid, null,
      entry->'header', entry->'items'
    );
    results := results || jsonb_build_array(jsonb_build_object('id',saved->>'id'));
  end loop;
  return results;
end $$;
revoke all on function public.import_expense_reports(jsonb) from public,anon,authenticated;
grant execute on function public.import_expense_reports(jsonb) to authenticated;
