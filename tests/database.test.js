import { before, after, beforeEach, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
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
