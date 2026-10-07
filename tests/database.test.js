import { before, after, beforeEach, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
test('generated closing-balance upgrade preserves values and allows atomic saves', async () => {
  const legacy = new PGlite()
  try {
    await legacy.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      insert into auth.users values('11111111-1111-4111-8111-111111111111','aftab@thi.com');
    `)
    await legacy.exec(readFileSync(new URL('../supabase/migrations/202610010001_secure_reports.sql', import.meta.url), 'utf8'))
    await legacy.exec(`
      alter table public.expense_reports drop column outstanding_balance;
      alter table public.expense_reports add column outstanding_balance numeric
        generated always as (prev_balance+cash_received-total_expenses) stored;
      insert into public.expense_reports(report_date,submitted_by,hod,institution,prev_balance,cash_received,total_expenses)
        values('2026-10-01','Legacy','HOD','THI',25,100,10);
    `)
    await legacy.exec(readFileSync(new URL('../supabase/migrations/202610010002_normalize_closing_balance.sql', import.meta.url), 'utf8'))
    await legacy.exec(readFileSync(new URL('../supabase/migrations/202610050001_recovery_and_submission_dates.sql', import.meta.url), 'utf8'))
    assert.equal((await legacy.query('select outstanding_balance from public.expense_reports')).rows[0].outstanding_balance, '115')
    await legacy.exec(`
      select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
      set role authenticated;
    `)
    const result = await legacy.query('select public.save_expense_report($1,$2,null,$3,$4) as report', [
      randomUUID(), randomUUID(), JSON.stringify(header()), JSON.stringify(items),
    ])
    assert.equal(Number(result.rows[0].report.outstanding_balance), 899.75)
  } finally {
    await legacy.close()
  }
})
const users = {
  creator: '11111111-1111-4111-8111-111111111111',
  second: '22222222-2222-4222-8222-222222222222',
  hod: '33333333-3333-4333-8333-333333333333',
  cfo: '44444444-4444-4444-8444-444444444444',
  outsider: '55555555-5555-4555-8555-555555555555',
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`)
  const emails = [
    'aftab@thi.com',
    'idrees@thi.com',
    'zeeshan@thi.com',
    'arshad@thi.com',
    'outsider@example.com',
  ]
  for (const [i, id] of Object.values(users).entries())
    await db.query('insert into auth.users values($1,$2)', [id, emails[i]])
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202610010001_secure_reports.sql', import.meta.url),
      'utf8',
    ),
  )
  await db.exec(readFileSync(new URL('../supabase/migrations/202610010002_normalize_closing_balance.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/202610050001_recovery_and_submission_dates.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/202610050002_excel_import.sql', import.meta.url), 'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/202610070001_withdraw_reports.sql', import.meta.url), 'utf8'))
})
after(() => db.close())
beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
async function login(role) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [users[role]])
  await db.exec('set local role authenticated')
}
async function denied(run, pattern) {
  await db.exec('savepoint rejection')
  await assert.rejects(run, pattern)
  await db.exec('rollback to savepoint rejection')
}
const header = (status = 'draft', opening = 0) => ({
  report_date: '2026-10-01',
  prev_balance: opening,
  cash_received: 1000,
  status,
})
const items = [
  { description: 'Pipe repair', section: 'Civil Works', category: 'Maintenance', amount: 100.25 },
]
async function save({
  request = randomUUID(),
  id = null,
  revision = null,
  data = header(),
  lines = items,
} = {}) {
  const result = await db.query('select public.save_expense_report($1,$2,$3,$4,$5) as report', [
    request,
    id,
    revision,
    JSON.stringify(data),
    JSON.stringify(lines),
  ])
  return result.rows[0].report
}
async function approve(report, status) {
  const result = await db.query('select public.approve_expense_report($1,$2,$3) as report', [
    report.id,
    report.revision,
    status,
  ])
  return result.rows[0].report
}

async function withdraw(report) {
  return (await db.query('select public.withdraw_expense_report($1,$2) as report', [report.id, report.revision])).rows[0].report
}
test('creator can withdraw at every approval stage, preserving submitted snapshot and safe retry', async () => {
  for (const status of ['submitted', 'hod_approved', 'cfo_approved']) {
    await login('creator')
    let report = await save({ data: header('submitted') })
    if (status !== 'submitted') { await login('hod'); report = await approve(report, 'hod_approved') }
    if (status === 'cfo_approved') { await login('cfo'); report = await approve(report, 'cfo_approved') }
    await login('creator')
    const draft = await withdraw(report)
    assert.equal(draft.status, 'draft')
    assert.equal(draft.submitted_at, null)
    assert.equal(draft.revision, report.revision + 1)
    assert.deepEqual(await withdraw(report), draft)
    const audit = (await db.query('select * from public.report_events where report_id=$1 and revision=$2', [report.id, draft.revision])).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].from_status, status)
    assert.equal(audit[0].report_snapshot.report.status, status)
    assert.equal(audit[0].report_snapshot.items.length, 1)
    await save({ id: draft.id, revision: draft.revision, lines: [{ ...items[0], description: 'Corrected', amount: 3 }] })
    const snapshot = (await db.query('select report_snapshot from public.report_events where report_id=$1 and revision=$2', [report.id, draft.revision])).rows[0].report_snapshot
    assert.equal(snapshot.items[0].description, 'Pipe repair')
    assert.equal(snapshot.items[0].amount, 100.25)
    await denied(() => withdraw(report), /Report changed/)
    assert.equal((await db.query('select public.department_summary() as s')).rows[0].s.outstanding_balance, null)
  }
})
test('withdrawal restores the previous shared balance and blocks dependent reports', async () => {
  await login('creator')
  const first = await save({ data: header('submitted') })
  await login('second')
  const second = await save({ data: header('submitted', first.outstanding_balance) })
  await login('creator')
  await denied(() => withdraw(first), /later report depends/)
  await login('second')
  await withdraw(second)
  const summary = (await db.query('select public.department_summary() as s')).rows[0].s
  assert.equal(Number(summary.outstanding_balance), first.outstanding_balance)
  assert.equal(summary.pending_approvals, 1)
  await login('creator')
  await withdraw(first)
  assert.equal((await db.query('select public.department_summary() as s')).rows[0].s.outstanding_balance, null)
})
test('withdrawal rejects other creators, approvers, inactive users, anonymous calls and stale revisions', async () => {
  await login('creator')
  const report = await save({ data: header('submitted') })
  await login('second')
  await denied(() => withdraw(report), /Only the creator/)
  for (const role of ['hod', 'cfo', 'outsider']) {
    await login(role)
    await denied(() => withdraw(report), /Only active creators/)
  }
  await login('creator')
  await denied(() => withdraw({ ...report, revision: null }), /Report changed/)
  await denied(() => withdraw({ ...report, revision: report.revision - 1 }), /Report changed/)
  await db.exec('reset role')
  await db.query('update public.profiles set active=false where id=$1', [users.creator])
  await login('creator')
  await denied(() => withdraw(report), /Only active creators/)
  await db.exec('reset role; set local role anon')
  await denied(() => withdraw(report), /permission denied/)
})
test('withdrawn reports need fresh approvals and stale withdrawals cannot affect resubmission', async () => {
  await login('creator')
  const submitted = await save({ data: header('submitted') })
  const draft = await withdraw(submitted)
  await login('hod')
  await denied(() => approve(submitted, 'hod_approved'), /Report changed/)
  await denied(() => approve(draft, 'hod_approved'), /not permitted/)
  await login('creator')
  const resubmitted = await save({ id: draft.id, revision: draft.revision, data: header('submitted') })
  await denied(() => withdraw(submitted), /Report changed/)
  await login('cfo')
  await denied(() => approve(resubmitted, 'cfo_approved'), /not permitted/)
  await login('hod')
  const approved = await approve(resubmitted, 'hod_approved')
  await login('creator')
  await denied(() => withdraw(resubmitted), /Report changed/)
  assert.equal((await withdraw(approved)).status, 'draft')
})

const importEntry = () => ({ request_id: randomUUID(), report_id: randomUUID(), header: header(), items })
async function importBatch(entries) {
  return (await db.query('select public.import_expense_reports($1) as result', [JSON.stringify(entries)])).rows[0].result
}
test('Excel import is atomic when a later report fails validation', async () => {
  await login('creator')
  const entries = [importEntry(), importEntry()].sort((a, b) => a.request_id.localeCompare(b.request_id))
  entries[1].items = [{ ...items[0], amount: -1 }]
  await denied(() => importBatch(entries), /Invalid description/)
  assert.equal((await db.query('select count(*)::int as n from public.expense_reports')).rows[0].n, 0)
  await db.exec('reset role')
  assert.equal((await db.query('select count(*)::int as n from public.report_save_requests')).rows[0].n, 0)
})
test('Excel import retries reuse drafts, cannot change owners or bypass approvals', async () => {
  await login('creator')
  const entries = [importEntry(), importEntry()]
  entries[0].header.created_by = users.second
  entries[0].header.submitted_by = 'Forged'
  const first = await importBatch(entries)
  assert.deepEqual(await importBatch(entries), first)
  const rows = (await db.query('select * from public.expense_reports')).rows
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.created_by === users.creator && r.status === 'draft' && r.submitted_by !== 'Forged'))
  assert.equal((await db.query('select count(*)::int as n from public.report_events')).rows[0].n, 2)
  const summary = (await db.query('select public.department_summary() as summary')).rows[0].summary
  assert.equal(summary.outstanding_balance, null)
  for (const status of ['submitted', 'hod_approved', 'cfo_approved'])
    await denied(() => importBatch([{ ...importEntry(), header: header(status) }]), /must create drafts/)
  await login('second')
  await denied(() => importBatch(entries), /different data/)
  await denied(() => importBatch([{ ...importEntry(), report_id: rows[0].id }]), /not owned/)
  await login('creator')
  await denied(() => importBatch([{ ...importEntry(), report_id: rows[0].id }]), /Report changed/)
})
test('Excel import enforces role, batch limits and unique IDs', async () => {
  for (const role of ['hod', 'cfo', 'outsider']) {
    await login(role)
    await denied(() => importBatch([importEntry()]), /Only active creators/)
  }
  await login('creator')
  await denied(() => importBatch([]), /between 1 and 50/)
  await denied(() => importBatch(Array.from({ length: 51 }, importEntry)), /between 1 and 50/)
  const entry = importEntry()
  await denied(() => importBatch([entry, entry]), /Duplicate/)
  await db.exec('reset role; set local role anon')
  await denied(() => importBatch([entry]), /permission denied/)
})
test('direct writes and client role escalation are denied', async () => {
  await login('creator')
  await denied(
    () =>
      db.exec(
        "insert into public.expense_reports(report_date,status) values('2026-10-01','cfo_approved')",
      ),
    /permission denied/,
  )
  await denied(() => db.exec("update public.profiles set role='cfo'"), /permission denied/)
  await denied(() => save({ data: header('cfo_approved') }), /Invalid initial/)
})
test('invalid items leave no report or idempotency record', async () => {
  await login('creator')
  await denied(() => save({ lines: [{ ...items[0], description: '' }] }), /Invalid description/)
  assert.equal(
    (await db.query('select count(*)::int as n from public.expense_reports')).rows[0].n,
    0,
  )
  await db.exec('reset role')
  assert.equal(
    (await db.query('select count(*)::int as n from public.report_save_requests')).rows[0].n,
    0,
  )
})
test('late item insert failure rolls back header and ledger event', async () => {
  await db.exec(
    "create function public.reject_test_item() returns trigger language plpgsql as $$ begin raise exception 'injected item failure'; end $$; create trigger reject_item before insert on public.expense_items for each row execute function public.reject_test_item();",
  )
  await login('creator')
  await denied(() => save(), /injected item failure/)
  assert.equal(
    (await db.query('select count(*)::int as n from public.expense_reports')).rows[0].n,
    0,
  )
})
test('retry returns the same report; changed payload cannot reuse a request key', async () => {
  await login('creator')
  const request = randomUUID()
  const first = await save({ request })
  assert.deepEqual(await save({ request }), first)
  await denied(() => save({ request, data: { ...header(), cash_received: 999 } }), /different data/)
  assert.equal(
    (await db.query('select count(*)::int as n from public.expense_reports')).rows[0].n,
    1,
  )
})
test('a lost response followed by a changed request cannot duplicate a client report ID', async () => {
  await login('creator')
  const id = randomUUID()
  await save({ id })
  await denied(() => save({ id, data: { ...header(), cash_received: 500 } }), /Report changed/)
  assert.equal(
    (await db.query('select count(*)::int as n from public.expense_reports')).rows[0].n,
    1,
  )
})
test('owner edits existing draft atomically and stale revisions fail', async () => {
  await login('creator')
  const first = await save()
  const changed = await save({ id: first.id, revision: 1, lines: [{ ...items[0], amount: 200.1 }] })
  assert.equal(changed.id, first.id)
  assert.equal(changed.total_expenses, 200.1)
  assert.equal(changed.revision, 2)
  await denied(() => save({ id: first.id, revision: 1 }), /Report changed/)
  await login('second')
  await denied(() => save({ id: first.id, revision: 2 }), /not owned/)
})
test('only correct approvers advance status and audit history records actors', async () => {
  await login('creator')
  const report = await save({ data: header('submitted') })
  await denied(() => approve(report, 'cfo_approved'), /not permitted/)
  await login('hod')
  await denied(() => approve(report, 'cfo_approved'), /not permitted/)
  const hod = await approve(report, 'hod_approved')
  await login('cfo')
  const final = await approve(hod, 'cfo_approved')
  assert.equal(final.total_expenses, 100.25)
  await denied(
    () => db.query('update public.expense_reports set total_expenses=1 where id=$1', [report.id]),
    /permission denied/,
  )
  await denied(
    () => db.query('insert into public.expense_items(report_id,amount) values($1,1)', [report.id]),
    /permission denied/,
  )
  const events = await db.query(
    'select actor_id,to_status from public.report_events where report_id=$1 order by revision',
    [report.id],
  )
  assert.deepEqual(
    events.rows.map((e) => e.actor_id),
    [users.creator, users.hod, users.cfo],
  )
  await login('creator')
  await denied(() => save({ id: final.id, revision: final.revision }), /Report changed/)
  await denied(
    () => db.query('insert into public.expense_items(report_id,amount) values($1,1)', [report.id]),
    /permission denied/,
  )
})
test('shared department ledger rejects stale openings and excludes drafts', async () => {
  await login('creator')
  const first = await save({ data: header('submitted') })
  await save()
  await login('second')
  await denied(() => save({ data: header('submitted') }), /balance changed/)
  const next = await save({ data: header('submitted', first.outstanding_balance) })
  const summary = (await db.query('select public.department_summary() as value')).rows[0].value
  assert.equal(summary.outstanding_balance, next.outstanding_balance)
  assert.equal(summary.pending_approvals, 2)
})
test('unknown and disabled accounts cannot access reports or functions', async () => {
  await login('creator')
  await save()
  await login('outsider')
  assert.equal((await db.query('select * from public.expense_reports')).rows.length, 0)
  await denied(() => save(), /Only active creators/)
  await denied(() => db.query('select public.department_summary()'), /Staff access required/)
  await db.exec('reset role')
  await db.query('update public.profiles set active=false where id=$1', [users.creator])
  await login('creator')
  assert.equal((await db.query('select * from public.expense_reports')).rows.length, 0)
})
test('database rejects fractional paisa, invalid sections and invalid calendar dates', async () => {
  await login('creator')
  await denied(() => save({ lines: [{ ...items[0], amount: 0.004 }] }), /Invalid description/)
  await denied(
    () => save({ lines: [{ ...items[0], section: 'constructor' }] }),
    /Invalid description/,
  )
  await denied(() => save({ data: { ...header(), report_date: '2026-02-30' } }), /out of range/)
})

test('future submissions cannot poison the shared ledger, including future drafts', async () => {
  await login('creator')
  const future = { ...header('submitted'), report_date: '9999-12-31' }
  await denied(() => save({ data: future }), /cannot be in the future/)
  const draft = await save({ data: { ...future, status: 'draft' } })
  await denied(() => save({ id: draft.id, revision: draft.revision, data: future }), /cannot be in the future/)
  const day = (await db.query("select (clock_timestamp() at time zone 'Asia/Karachi')::date::text as day")).rows[0].day
  const first = await save({ data: { ...header('submitted'), report_date: day } })
  await login('second')
  const next = await save({ data: { ...header('submitted', first.outstanding_balance), report_date: day } })
  assert.equal(next.status, 'submitted')
})

test('discard blocks late save retries and resolution is restricted to the owner', async () => {
  const request = randomUUID()
  const resolve = (discard) => db.query('select public.resolve_report_save($1,$2) as value', [request, discard])
  await login('outsider')
  await denied(() => resolve(true), /Only active creators/)
  await login('creator')
  assert.equal((await resolve(false)).rows[0].value.status, 'unknown')
  assert.equal((await resolve(true)).rows[0].value.status, 'cancelled')
  assert.equal((await resolve(true)).rows[0].value.status, 'cancelled')
  await denied(() => save({ request }), /already used/)
  await login('second')
  await denied(() => resolve(false), /not owned/)
  assert.equal((await db.query('select count(*)::int as n from public.expense_reports')).rows[0].n, 0)
})

test('discard reports a committed save without deleting or duplicating it', async () => {
  await login('creator')
  const request = randomUUID()
  const report = await save({ request })
  const result = await db.query('select public.resolve_report_save($1,true) as value', [request])
  assert.deepEqual(result.rows[0].value, { status: 'saved', report_id: report.id })
  assert.equal((await save({ request })).id, report.id)
  assert.equal((await db.query('select count(*)::int as n from public.expense_reports')).rows[0].n, 1)
})
