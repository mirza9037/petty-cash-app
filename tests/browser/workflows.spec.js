import { test, expect } from '@playwright/test'
const uid = '11111111-1111-4111-8111-111111111111'
const reportId = '22222222-2222-4222-8222-222222222222'
const baseReport = {
  id: reportId,
  created_by: uid,
  revision: 1,
  report_date: '2026-10-01',
  submitted_by: 'Aftab Ahmed',
  status: 'draft',
  prev_balance: 0,
  cash_received: 1000,
  total_expenses: 100,
  outstanding_balance: 900,
  created_at: '2026-10-01T01:00:00Z',
}
const baseItems = [
  {
    id: 'line-1',
    report_id: reportId,
    sno: 1,
    description: 'Pipe repair',
    section: 'Civil Works',
    category: 'Maintenance',
    amount: 100,
  },
]
async function setup(page, role = 'creator') {
  const state = {
    reports: [{ ...baseReport }],
    items: structuredClone(baseItems),
    events: [],
    writes: [],
    requests: new Map(),
    itemsFail: false,
    reportsFail: false,
    approvalFail: false,
    loseSaveResponse: false,
  }
  const user = {
    id: uid,
    email: 'aftab@thi.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
  }
  const expiry = Math.floor(Date.now() / 1000) + 3600
  const token =
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify({ sub: uid, exp: expiry, role: 'authenticated' })).toString(
      'base64url',
    ) +
    '.test'
  await page.addInitScript(
    (session) => localStorage.setItem('sb-review-auth-token', JSON.stringify(session)),
    {
      access_token: token,
      refresh_token: 'test',
      expires_at: expiry,
      expires_in: 3600,
      token_type: 'bearer',
      user,
    },
  )
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.hostname === '127.0.0.1') return route.continue()
    if (url.hostname !== 'review.supabase.co') return route.abort()
    const reply = (body, status = 200, extra = {}) =>
      route.fulfill({
        status,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          ...extra,
        },
        body: JSON.stringify(body),
      })
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
        },
      })
    if (url.pathname.includes('/auth/')) return reply(user)
    if (url.pathname.endsWith('profiles'))
      return reply({ id: uid, role, display_name: 'Aftab Ahmed', active: true })
    if (url.pathname.endsWith('department_summary'))
      return reply({ outstanding_balance: 0, pending_approvals: 0, month_expenses: 0 })
    if (url.pathname.endsWith('save_expense_report')) {
      const args = request.postDataJSON()
      state.writes.push(args)
      if (state.requests.has(args.p_request_id)) return reply(state.requests.get(args.p_request_id))
      const saved = {
        ...baseReport,
        ...args.p_header,
        id: args.p_report_id,
        revision: (args.p_expected_revision || 0) + 1,
        total_expenses: args.p_items.reduce((n, i) => n + i.amount, 0),
      }
      saved.outstanding_balance = saved.prev_balance + saved.cash_received - saved.total_expenses
      state.reports = state.reports.filter((r) => r.id !== saved.id).concat(saved)
      state.items = args.p_items.map((item, i) => ({
        ...item,
        id: 'line-' + i,
        report_id: saved.id,
        sno: i + 1,
      }))
      state.requests.set(args.p_request_id, saved)
      if (state.loseSaveResponse) {
        state.loseSaveResponse = false
        return reply({ message: 'lost response' }, 503)
      }
      return reply(saved)
    }
    if (url.pathname.endsWith('approve_expense_report')) {
      const args = request.postDataJSON()
      state.writes.push(args)
      if (state.approvalFail)
        return reply({ code: '40001', message: 'Report changed. Reload before approving.' }, 409)
      const report = state.reports.find((r) => r.id === args.p_report_id)
      Object.assign(report, { status: args.p_status, revision: report.revision + 1 })
      return reply(report)
    }
    if (url.pathname.endsWith('expense_reports')) {
      if (state.reportsFail) return reply({ message: 'outage' }, 503, { 'retry-after': '0' })
      if (url.searchParams.has('id'))
        return reply(state.reports.find((r) => r.id === url.searchParams.get('id').slice(3)))
      return reply(state.reports, 200, {
        'content-range': '0-' + (state.reports.length - 1) + '/' + state.reports.length,
        'access-control-expose-headers': 'content-range',
      })
    }
    if (url.pathname.endsWith('expense_items'))
      return state.itemsFail
        ? reply({ message: 'outage' }, 503, { 'retry-after': '0' })
        : reply(state.items)
    if (url.pathname.endsWith('report_events')) return reply(state.events)
    return reply({ message: 'unhandled route' }, 404)
  })
  return state
}
test('invalid inputs do not write; a corrected submission writes once', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/report/new')
  await page.getByRole('button', { name: 'Submit for Approval' }).click()
  await expect(page.getByRole('alert')).toContainText('Row 1: Description is required')
  expect(state.writes).toHaveLength(0)
  await page.getByLabel('Description row 1').fill('Repair')
  await page.getByLabel('Amount row 1').fill('0.004')
  await page.getByRole('button', { name: 'Submit for Approval' }).click()
  await expect(page.getByRole('alert')).toContainText('two decimal')
  expect(state.writes).toHaveLength(0)
  await page.getByLabel('Amount row 1').fill('100')
  await page.getByRole('button', { name: 'Submit for Approval' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  expect(state.writes).toHaveLength(1)
})
test('draft editor loads existing items and updates the same report', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByLabel('Description row 1')).toHaveValue('Pipe repair')
  await page.getByLabel('Amount row 1').fill('250.50')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  expect(state.writes[0].p_report_id).toBe(reportId)
  expect(state.writes[0].p_expected_revision).toBe(1)
  expect(state.reports).toHaveLength(1)
})
test('lost save response can be retried without a duplicate report', async ({ page }) => {
  const state = await setup(page)
  state.reports = []
  state.loseSaveResponse = true
  await page.goto('/report/new')
  await page.getByLabel('Description row 1').fill('Repair')
  await page.getByLabel('Amount row 1').fill('100')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be completed')
  await page.reload()
  await expect(page.getByLabel('Description row 1')).toHaveValue('Repair')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  expect(state.reports).toHaveLength(1)
  expect(state.writes[0].p_request_id).toBe(state.writes[1].p_request_id)
})
test('failed item load disables export until retry succeeds', async ({ page }) => {
  const state = await setup(page)
  state.itemsFail = true
  await page.goto('/report/' + reportId)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toHaveCount(0)
  state.itemsFail = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
})
test('dashboard distinguishes failed loading from an empty dataset', async ({ page }) => {
  const state = await setup(page)
  state.reportsFail = true
  await page.goto('/dashboard')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('No reports match these filters.')).toHaveCount(0)
  await expect(page.locator('.dash-card-value').first()).toHaveText('—')
  state.reportsFail = false
  await page.getByRole('button', { name: 'Retry loading' }).click()
  await expect(page.getByRole('button', { name: 'View', exact: true })).toBeVisible()
})
test('approval failures are shown and successful approval supplies expected revision', async ({
  page,
}) => {
  const state = await setup(page, 'hod')
  state.reports[0].status = 'submitted'
  state.approvalFail = true
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'HOD Approve' }).click()
  await expect(page.getByRole('alert')).toContainText('Report changed')
  state.approvalFail = false
  await page.getByRole('button', { name: 'HOD Approve' }).click()
  await expect(page.locator('.dash-badge')).toHaveText('HOD Approved')
  expect(state.writes[0].p_expected_revision).toBe(1)
})
test('non-creators cannot open the editor', async ({ page }) => {
  await setup(page, 'cfo')
  await page.goto('/report/new')
  await expect(page.getByRole('alert')).toContainText('Only creators')
  await expect(page.getByRole('button', { name: 'Save as Draft' })).toHaveCount(0)
})
test('mobile form fits viewport and PDF download is available', async ({ page }) => {
  await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/report/new')
  await expect(page.getByLabel('Description row 1')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.goto('/report/' + reportId)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  expect((await download).suggestedFilename()).toMatch(/^expense-report-.*\.pdf$/)
})
