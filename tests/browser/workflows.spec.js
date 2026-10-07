import { test, expect } from '@playwright/test'
import { templateBuffer } from '../../src/lib/excel.js'
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
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
    saveFail: false,
    recoveryFail: false,
    cancelled: new Set(),
    approvalGate: null,
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
    if (url.pathname.endsWith('import_expense_reports')) {
      const args = request.postDataJSON()
      state.writes.push(args)
      const result = args.p_reports.map((r) => ({ id: r.report_id }))
      for (const r of args.p_reports) {
        if (!state.reports.some((saved) => saved.id === r.report_id))
          state.reports.push({ ...baseReport, ...r.header, id: r.report_id })
      }
      if (state.loseSaveResponse) {
        state.loseSaveResponse = false
        return reply({ message: 'lost response' }, 503)
      }
      return reply(result)
    }
    if (url.pathname.endsWith('expense_reports') && url.searchParams.get('select')?.includes('expense_items')) {
      if (state.reportsFail) return reply({ message: 'outage' }, 503)
      const after = url.searchParams.get('id')?.replace('gt.', '')
      return reply(state.reports.filter((r) => !after || r.id > after).sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, Number(url.searchParams.get('limit'))).map((r) => ({ ...r, expense_items: state.items.filter((i) => i.report_id === r.id) })))
    }
    if (url.pathname.endsWith('resolve_report_save')) {
      if (state.recoveryFail) return reply({ message: 'offline' }, 503)
      const args = request.postDataJSON()
      const saved = state.requests.get(args.p_request_id)
      if (saved) return reply({ status: 'saved', report_id: saved.id })
      if (args.p_discard) state.cancelled.add(args.p_request_id)
      return reply({ status: state.cancelled.has(args.p_request_id) ? 'cancelled' : 'unknown' })
    }
    if (url.pathname.endsWith('save_expense_report')) {
      const args = request.postDataJSON()
      state.writes.push(args)
      if (state.saveFail) return reply({ message: 'save failed before commit' }, 503)
      if (state.cancelled.has(args.p_request_id)) return reply({ code: 'P0001', message: 'Request cancelled' }, 400)
      if (state.requests.has(args.p_request_id)) return reply(state.requests.get(args.p_request_id))
      const existing = state.reports.find((r) => r.id === args.p_report_id)
      if (existing && existing.revision !== args.p_expected_revision)
        return reply({ code: '40001', message: 'Report changed or was submitted. Reload before saving.' }, 409)
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
      if (state.approvalGate) await state.approvalGate
      if (state.approvalFail)
        return reply({ code: '40001', message: 'Report changed. Reload before approving.' }, 409)
      const report = state.reports.find((r) => r.id === args.p_report_id)
      Object.assign(report, { status: args.p_status, revision: report.revision + 1 })
      return reply(report)
    }
    if (url.pathname.endsWith('withdraw_expense_report')) {
      const args = request.postDataJSON()
      state.writes.push(args)
      if (state.withdrawalFail) return reply({ code: 'P0001', message: 'A later report depends on this balance.' }, 400)
      const report = state.reports.find((r) => r.id === args.p_report_id)
      if (report.status === 'draft' && report.revision === args.p_expected_revision + 1) return reply(report)
      if (report.revision !== args.p_expected_revision) return reply({ code: '40001', message: 'Report changed. Reload before withdrawing.' }, 409)
      state.events.push({ id: 'withdrawal', actor_name: 'Aftab Ahmed', from_status: report.status,
        to_status: 'draft', revision: report.revision + 1, created_at: new Date().toISOString(),
        report_snapshot: { report: structuredClone(report), items: structuredClone(state.items) } })
      Object.assign(report, { status: 'draft', submitted_at: null, revision: report.revision + 1 })
      if (state.loseSaveResponse) { state.loseSaveResponse = false; return reply({ message: 'lost response' }, 503) }
      return reply(report)
    }
    if (url.pathname.endsWith('delete_draft_report')) {
      const args = request.postDataJSON()
      state.writes.push(args)
      const report = state.reports.find((r) => r.id === args.p_report_id)
      if (state.deleteFail || report.status !== 'draft' || (!report.deleted_at && report.revision !== args.p_expected_revision))
        return reply({ code: '40001', message: 'Report changed or was submitted. Reload before deleting.' }, 409)
      if (!report.deleted_at) Object.assign(report, { deleted_at: new Date().toISOString(), revision: report.revision + 1 })
      if (state.loseSaveResponse) { state.loseSaveResponse = false; return reply({ message: 'lost response' }, 503) }
      return reply({ id: report.id, deleted: true, revision: report.revision })
    }
    if (url.pathname.endsWith('expense_reports')) {
      if (state.reportsFail) return reply({ message: 'outage' }, 503, { 'retry-after': '0' })
      if (url.searchParams.has('id'))
        return reply(state.reports.find((r) => r.id === url.searchParams.get('id').slice(3)))
      const rows = state.reports.filter((r) => !r.deleted_at && (!url.searchParams.has('status') || r.status === url.searchParams.get('status').slice(3)))
      return reply(rows, 200, {
        'content-range': '0-' + (rows.length - 1) + '/' + rows.length,
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

test('draft deletion confirms, safely retries lost responses and removes the row', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/dashboard')
  const remove = page.getByRole('button', { name: 'Delete draft', exact: true })
  await expect(remove).toBeVisible()
  page.once('dialog', (dialog) => dialog.dismiss())
  await remove.click()
  expect(state.writes).toHaveLength(0)
  state.deleteFail = true
  page.once('dialog', (dialog) => dialog.accept())
  await remove.click()
  await expect(page.getByRole('alert')).toContainText('Report changed or was submitted')
  state.deleteFail = false
  state.loseSaveResponse = true
  page.once('dialog', (dialog) => dialog.accept())
  await remove.click()
  await expect(page.getByRole('alert')).toContainText('Check your connection')
  page.once('dialog', (dialog) => dialog.accept())
  await remove.click()
  await expect(page.getByText('No reports match these filters.')).toBeVisible()
  expect(state.reports[0].revision).toBe(2)
})
test('administrator can delete staff drafts from details', async ({ page }) => {
  const state = await setup(page, 'admin')
  state.reports[0].created_by = 'other-creator'
  await page.goto('/report/' + reportId)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete draft', exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
  await expect(page.getByText('No reports match these filters.')).toBeVisible()
})
test('delete draft is hidden for other creators', async ({ page }) => {
  const state = await setup(page)
  state.reports[0].created_by = 'other-creator'
  await page.goto('/dashboard')
  await expect(page.getByRole('button', { name: 'View', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete draft', exact: true })).toHaveCount(0)
})

test('creator withdraws an approved report with snapshot and cleared signatures', async ({ page }) => {
  const state = await setup(page)
  state.reports[0].status = 'cfo_approved'
  state.reports[0].revision = 3
  state.events = [{ id: 'h', to_status: 'hod_approved', actor_name: 'Previous HOD', revision: 2, created_at: baseReport.created_at },
    { id: 'c', to_status: 'cfo_approved', actor_name: 'Previous CFO', revision: 3, created_at: baseReport.created_at }]
  await page.goto('/report/' + reportId)
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Withdraw to draft' }).click()
  expect(state.writes).toHaveLength(0)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Withdraw to draft' }).click()
  await expect(page.getByRole('button', { name: 'Edit draft' })).toBeVisible()
  await expect(page.locator('.rd-signatures')).not.toContainText('Previous HOD')
  await expect(page.locator('.rd-signatures')).not.toContainText('Previous CFO')
  await expect(page.locator('.audit-history')).toContainText('Withdrawn from CFO Approved to Draft')
  await page.getByText('Submitted details before withdrawal', { exact: true }).click()
  await expect(page.locator('.audit-history')).toContainText('Pipe repair')
  expect(state.writes[0]).toEqual({ p_report_id: reportId, p_expected_revision: 3 })
})

test('dashboard withdrawal recovers a lost response and shows blocked balance errors', async ({ page }) => {
  const state = await setup(page)
  state.reports[0].status = 'submitted'
  state.withdrawalFail = true
  await page.goto('/dashboard')
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Withdraw to draft' }).click()
  await expect(page.getByRole('alert')).toContainText('later report depends')
  expect(state.reports[0].status).toBe('submitted')
  state.withdrawalFail = false
  state.loseSaveResponse = true
  await page.getByRole('button', { name: 'Withdraw to draft' }).click()
  await expect(page.getByRole('alert')).toContainText('retry safely')
  await page.getByRole('button', { name: 'Withdraw to draft' }).click()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect(state.events).toHaveLength(1)
  expect(state.writes[2]).toEqual(state.writes[1])
})

test('withdrawal controls are hidden for approvers and reports owned by another creator', async ({ page }) => {
  const state = await setup(page, 'hod')
  state.reports[0].status = 'submitted'
  await page.goto('/report/' + reportId)
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Withdraw to draft' })).toHaveCount(0)
})

test('creator cannot withdraw another creator report through the UI', async ({ page }) => {
  const state = await setup(page)
  state.reports[0].status = 'submitted'
  state.reports[0].created_by = 'another-creator'
  await page.goto('/dashboard')
  await expect(page.getByRole('button', { name: 'View', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Withdraw to draft' })).toHaveCount(0)
})

test('administrator edits staff drafts and can perform HOD and CFO approvals', async ({ page }) => {
  const state = await setup(page, 'admin')
  state.reports[0].created_by = 'another-creator'
  state.reports[0].submitted_by = 'Idrees Ahmed'
  await page.goto('/dashboard')
  await expect(page.getByRole('button', { name: 'New Report' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByLabel('Description row 1')).toHaveValue('Pipe repair')
  await expect(page.getByLabel('Submitted By', { exact: true })).toHaveValue('Idrees Ahmed')
  await page.getByRole('button', { name: 'Submit for Approval' }).click()
  await page.getByRole('button', { name: 'Back to Dashboard' }).click()
  await page.getByRole('button', { name: 'HOD Approve', exact: true }).click()
  await page.getByRole('button', { name: 'CFO Approve', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Withdraw to draft' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'CFO Approved', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Excel import / export' }).click()
  await expect(page.getByRole('button', { name: 'Download import template' })).toBeVisible({ timeout: 20000 })
})

test('Excel template preview imports drafts and safely retries a lost response', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const state = await setup(page)
  state.loseSaveResponse = true
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Excel import / export' }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download import template' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('petty-cash-import-template.xlsx')
  await page.getByLabel('Choose Excel file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(await download.path()) })
  await expect(page.getByRole('button', { name: 'Import 1 reports as drafts' })).toBeEnabled({ timeout: 20000 })
  expect(state.writes).toHaveLength(0)
  await page.locator('summary').click()
  await expect(page.getByRole('cell', { name: 'Replace this example expense' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('excel-preview.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Import 1 reports as drafts' }).click()
  await expect(page.getByRole('alert')).toContainText('recover safely without duplicates')
  await page.getByRole('button', { name: 'Import 1 reports as drafts' }).click()
  await expect(page.getByRole('status')).toContainText('Import complete')
  expect(state.writes).toHaveLength(2)
  expect(state.writes[1]).toEqual(state.writes[0])
  expect(state.reports).toHaveLength(2)
  expect(state.writes[0].p_reports[0].header.status).toBe('draft')
})

test('invalid Excel rows show errors without database writes', async ({ page }) => {
  test.setTimeout(90000)
  const state = await setup(page)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await templateBuffer())
  book.getWorksheet('Items').getCell('E2').value = -10
  await page.goto('/excel')
  await page.getByLabel('Choose Excel file').setInputFiles({ name: 'invalid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await book.xlsx.writeBuffer()) })
  await expect(page.getByRole('alert')).toContainText('Items row 2: Amount cannot be negative', { timeout: 20000 })
  expect(state.writes).toHaveLength(0)
  await expect(page.getByRole('button', { name: /Import \d+ reports as drafts/ })).toHaveCount(0)
})

test('crafted Excel archive is rejected in the worker without database writes', async ({ page }) => {
  test.setTimeout(90000)
  const state = await setup(page)
  const buffer = Buffer.from(await templateBuffer())
  buffer.writeUInt16LE(0, buffer.length - 14)
  buffer.writeUInt16LE(0, buffer.length - 12)
  await page.goto('/excel')
  await page.getByLabel('Choose Excel file').setInputFiles({ name: 'crafted.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
  await expect(page.getByRole('alert')).toContainText('Cannot read this workbook archive', { timeout: 20000 })
  expect(state.writes).toHaveLength(0)
  await expect(page.getByLabel('Choose Excel file')).toBeEnabled()
  await expect(page.getByRole('button', { name: /Import \d+ reports as drafts/ })).toHaveCount(0)
})

test('Excel export includes records beyond one page, numeric values and items', async ({ page }) => {
  test.setTimeout(90000)
  const state = await setup(page, 'hod')
  state.reports = Array.from({ length: 105 }, (_, i) => ({ ...baseReport, id: String(i).padStart(8, '0') + '-1111-4111-8111-111111111111' }))
  state.items = state.reports.map((r) => ({ ...baseItems[0], report_id: r.id }))
  await page.goto('/excel')
  await expect(page.getByLabel('Choose Excel file')).toHaveCount(0)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Excel', exact: true }).click()
  const book = new ExcelJS.Workbook()
  await book.xlsx.readFile(await (await downloaded).path())
  expect(book.getWorksheet('Reports').rowCount).toBe(106)
  expect(book.getWorksheet('Items').rowCount).toBe(106)
  expect(book.getWorksheet('Items').getCell('E106').value).toBe(100)
  await expect(page.getByRole('status')).toContainText('Downloaded 105 reports')
})

test('failed Excel export shows an error instead of downloading partial data', async ({ page }) => {
  test.setTimeout(90000)
  const state = await setup(page)
  state.reportsFail = true
  const downloads = []
  page.on('download', (download) => downloads.push(download))
  await page.goto('/excel')
  await page.getByRole('button', { name: 'Download Excel', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be completed')
  expect(downloads).toHaveLength(0)
})
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
test('lost save response is recovered after reload without a duplicate report', async ({ page }) => {
  const state = await setup(page)
  state.reports = []
  state.loseSaveResponse = true
  await page.goto('/report/new')
  await page.getByLabel('Description row 1').fill('Repair')
  await page.getByLabel('Amount row 1').fill('100')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be completed')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  expect(state.reports).toHaveLength(1)
  expect(state.writes).toHaveLength(1)
})

test('failed draft edits survive reload and retry with the same revision and request', async ({ page }) => {
  const state = await setup(page)
  state.saveFail = true
  await page.goto('/report/' + reportId + '/edit')
  await page.getByLabel('Description row 1').fill('Recovered edits')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be completed')
  await page.reload()
  await expect(page.getByLabel('Description row 1')).toHaveValue('Recovered edits')
  state.saveFail = false
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  expect(state.writes[1].p_request_id).toBe(state.writes[0].p_request_id)
  expect(state.writes[1].p_expected_revision).toBe(1)
})

test('recovered edits cannot overwrite a newer draft revision', async ({ page }) => {
  const state = await setup(page)
  state.saveFail = true
  await page.goto('/report/' + reportId + '/edit')
  await page.getByLabel('Description row 1').fill('Recovered edits')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  state.reports[0].revision = 2
  state.items[0].description = 'Newer saved edits'
  state.saveFail = false
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('draft changed')
  await expect(page.getByLabel('Description row 1')).toHaveValue('Recovered edits')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('alert')).toContainText('Report changed')
  expect(state.items[0].description).toBe('Newer saved edits')
  expect(state.writes[1].p_expected_revision).toBe(1)
})

test('discard clears failed save recovery and starts a fresh report', async ({ page }) => {
  const state = await setup(page)
  state.saveFail = true
  await page.goto('/report/new')
  await page.getByLabel('Description row 1').fill('Discard me')
  await page.getByLabel('Amount row 1').fill('10')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Back to dashboard' }).click()
  await page.getByRole('button', { name: 'New Report' }).click()
  await expect(page.getByLabel('Description row 1')).toHaveValue('')
  expect(state.cancelled.has(state.writes[0].p_request_id)).toBe(true)
  state.saveFail = false
  await page.getByLabel('Description row 1').fill('Fresh report')
  await page.getByLabel('Amount row 1').fill('20')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  expect(state.writes[1].p_report_id).not.toBe(state.writes[0].p_report_id)
})

test('discard retains recovery while offline and reveals a save that already committed', async ({ page }) => {
  const state = await setup(page)
  state.loseSaveResponse = true
  await page.goto('/report/new')
  await page.getByLabel('Description row 1').fill('Already saved')
  await page.getByLabel('Amount row 1').fill('10')
  await page.getByRole('button', { name: 'Save as Draft' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  page.on('dialog', (dialog) => dialog.accept())
  state.recoveryFail = true
  await page.getByRole('button', { name: 'Back to dashboard' }).click()
  await expect(page.getByRole('alert')).toContainText('Your edits are retained')
  await expect(page.getByLabel('Description row 1')).toHaveValue('Already saved')
  state.recoveryFail = false
  await page.getByRole('button', { name: 'Back to dashboard' }).click()
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeEnabled()
  expect(state.writes).toHaveLength(1)
})

test('future dates are rejected before submission writes', async ({ page }) => {
  const state = await setup(page)
  await page.goto('/report/new')
  await page.getByLabel('Description row 1').fill('Repair')
  await page.getByLabel('Amount row 1').fill('10')
  await page.getByLabel('Dated').fill('9999-12-31')
  await page.getByRole('button', { name: 'Submit for Approval' }).click()
  await expect(page.getByRole('alert')).toContainText('cannot be in the future')
  expect(state.writes).toHaveLength(0)
})

test('approval refresh respects filters changed while approval was pending', async ({ page }) => {
  const state = await setup(page, 'hod')
  state.reports[0].status = 'submitted'
  let release
  state.approvalGate = new Promise((resolve) => { release = resolve })
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'HOD Approve' }).click()
  await expect.poll(() => state.writes.length).toBe(1)
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('draft')
  await expect(page.getByText('No reports match these filters.')).toBeVisible()
  const refresh = page.waitForRequest((request) => request.url().includes('/expense_reports'))
  release()
  const refreshed = await refresh
  expect(new URL(refreshed.url()).searchParams.get('status')).toBe('eq.draft')
  await expect(page.getByText('No reports match these filters.')).toBeVisible()
  await expect(page.locator('.dash-badge')).toHaveCount(0)
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
