import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toPaisa, sumMoney } from '../src/lib/money.js'
import { today, groupItems } from '../src/lib/domain.js'
import { reportSchema, lineItemsSchema, validate } from '../src/lib/validation.js'
import { buildReportPdf } from '../src/lib/pdf.js'
test('money is summed as integer paisa and rejects excess precision', () => {
  assert.equal(toPaisa('0.29'), 29)
  assert.equal(sumMoney([{ amount: 0.1 }, { amount: 0.2 }]), 0.3)
  for (const value of ['0.004', '1e2', 'NaN', '', Infinity, '1000000000'])
    assert.throws(() => toPaisa(value))
})
test('date follows Karachi calendar including month boundary', () => {
  assert.equal(today(new Date('2026-10-01T01:00:00+05:00')), '2026-10-01')
  assert.equal(today(new Date('2026-09-30T23:59:00+05:00')), '2026-09-30')
  assert.equal(
    reportSchema.safeParse({
      report_date: '2026-02-30',
      prev_balance: 0,
      cash_received: 0,
      status: 'draft',
    }).success,
    false,
  )
})
test('line validation names the row and blocks unknown sections', () => {
  const row = {
    description: 'Repair',
    section: 'Civil Works',
    category: 'Maintenance',
    amount: '1.25',
  }
  assert.equal(validate(lineItemsSchema, [row]).success, true)
  assert.match(validate(lineItemsSchema, [row, { ...row, description: ' ' }]).error, /Row 2/)
  assert.equal(validate(lineItemsSchema, [{ ...row, section: 'constructor' }]).success, false)
})
test('legacy section names cannot collide with object prototypes', () => {
  const grouped = groupItems(
    ['constructor', '__proto__', 'toString'].map((section) => ({ section, amount: 1 })),
  )
  assert.equal(grouped.length, 3)
  assert.ok(grouped.every((group) => group.items.length === 1))
})
test('long PDF uses multiple pages, repeats headers, and includes approval status', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    description: 'Long maintenance description '.repeat(5) + (i + 1),
    section: 'Civil Works',
    category: 'Maintenance',
    amount: 1.25,
  }))
  const doc = buildReportPdf(
    {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'draft',
      submitted_by: 'Aftab Ahmed',
      report_date: '2026-10-01',
      prev_balance: 0,
      cash_received: 200,
      total_expenses: 125,
      outstanding_balance: 75,
    },
    rows,
  )
  assert.ok(doc.getNumberOfPages() > 2)
  const content = doc.output()
  assert.match(content, /Status: Draft/)
  assert.ok(content.split('Amount \\(PKR\\)').length > 2)
  assert.match(content, /Grand total/)
})
