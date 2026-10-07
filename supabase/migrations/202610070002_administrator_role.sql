begin;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('creator','hod','cfo','admin'));

-- Extend the existing RPCs without duplicating their financial validation,
-- ledger locks, audit snapshots, idempotency or revision checks. Fail closed if
-- the expected authorization clauses have changed since these migrations.
do $$
declare change record; definition text;
begin
  for change in select * from (values
    ('public.save_expense_report(uuid,uuid,integer,jsonb,jsonb)',
      'and role=''creator''', 'and role in (''creator'',''admin'')'),
    ('public.save_expense_report(uuid,uuid,integer,jsonb,jsonb)',
      'if found and existing.created_by is distinct from auth.uid() then',
      'if found and existing.created_by is distinct from auth.uid() and staff.role<>''admin'' then'),
    ('public.save_expense_report(uuid,uuid,integer,jsonb,jsonb)',
      'Only active creators can save reports.', 'Only active creators and administrators can save reports.'),
    ('public.resolve_report_save(uuid,boolean)',
      'and role=''creator''', 'and role in (''creator'',''admin'')'),
    ('public.resolve_report_save(uuid,boolean)',
      'Only active creators can resolve saves.', 'Only active creators and administrators can resolve saves.'),
    ('public.import_expense_reports(jsonb)',
      'and role=''creator''', 'and role in (''creator'',''admin'')'),
    ('public.import_expense_reports(jsonb)',
      'Only active creators can import reports.', 'Only active creators and administrators can import reports.'),
    ('public.withdraw_expense_report(uuid,integer)',
      'and role=''creator''', 'and role in (''creator'',''admin'')'),
    ('public.withdraw_expense_report(uuid,integer)',
      'if report.created_by is distinct from auth.uid() then',
      'if report.created_by is distinct from auth.uid() and staff.role<>''admin'' then'),
    ('public.withdraw_expense_report(uuid,integer)',
      'Only active creators can withdraw reports.', 'Only active creators and administrators can withdraw reports.'),
    ('public.approve_expense_report(uuid,integer,text)',
      'staff.role=''hod''', 'staff.role in (''hod'',''admin'')'),
    ('public.approve_expense_report(uuid,integer,text)',
      'staff.role=''cfo''', 'staff.role in (''cfo'',''admin'')')
  ) as changes(signature,old_clause,new_clause)
  loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if strpos(definition,change.old_clause)=0 then
      raise exception 'Expected authorization clause missing in %. Review the migration before deploying.',change.signature;
    end if;
    execute replace(definition,change.old_clause,change.new_clause);
  end loop;
end $$;
-- Profile roles remain administrator-managed; no client write grant is added.
commit;
