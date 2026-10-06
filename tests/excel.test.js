import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { templateBuffer, parseImport, importPayload, exportBuffer, MAX_FILE_BYTES, checkArchiveSize } from '../src/lib/excel.js'

async function workbook() {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await templateBuffer())
  return book
}
async function parseChanged(change) {
  const book = await workbook()
  change(book)
  return parseImport(await book.xlsx.writeBuffer())
}
test('template round trips multiple reports, Excel dates and exact decimal amounts', async () => {
  const reports = await parseChanged((book) => {
    book.getWorksheet('Reports').addRow(['SECOND', new Date('2026-09-30T00:00:00Z'), 12.34, 99.99])
    book.getWorksheet('Items').getCell('E2').value = 0.29
    book.getWorksheet('Items').addRow(['SECOND', 'Repair', 'HVAC', 'Maintenance', 1.01])
  })
  assert.equal(reports.length, 2)
  assert.equal(reports[1].header.report_date, '2026-09-30')
  assert.equal(reports[0].items[0].amount, 0.29)
  assert.equal(reports[1].header.status, 'draft')
  const first = await importPayload(reports, 'user-1')
  assert.deepEqual(await importPayload(reports, 'user-1'), first)
  assert.notEqual((await importPayload(reports, 'user-2'))[0].request_id, first[0].request_id)
  reports[0].items[0].amount = 1
  assert.notEqual((await importPayload(reports, 'user-1'))[0].request_id, first[0].request_id)
})
test('invalid cells fail with worksheet row context before any save', async () => {
  const cases = [
    ['Items', 'E2', -1, /Items row 2: Amount cannot be negative/],
    ['Items', 'E2', 1.005, /two decimal/],
    ['Items', 'E2', { formula: '1+1', result: 2 }, /formulas/],
    ['Items', 'B2', { text: 'Link', hyperlink: 'https://example.com' }, /links/],
    ['Items', 'C2', 'Unknown', /Items row 2/],
    ['Items', 'A2', 'MISSING', /unknown Report Key/],
    ['Reports', 'B2', '2026-02-30', /valid report date/],
    ['Reports', 'C2', null, /valid amount/],
  ]
  for (const [sheet, cell, value, message] of cases)
    await assert.rejects(() => parseChanged((book) => { book.getWorksheet(sheet).getCell(cell).value = value }), message)
})
test('rejects duplicate keys, orphan reports, wrong headers and oversized inputs', async () => {
  await assert.rejects(() => parseChanged((book) => { book.getWorksheet('Reports').addRow(['REPORT-001', '2026-10-01', 0, 0]) }), /duplicate/)
  await assert.rejects(() => parseChanged((book) => { book.getWorksheet('Items').getRow(2).values = [] }), /at least one expense/)
  await assert.rejects(() => parseChanged((book) => { book.getWorksheet('Items').getCell('B1').value = 'Something' }), /must be named/)
  await assert.rejects(() => parseImport(new Uint8Array(MAX_FILE_BYTES + 1)), /up to 2 MB/)
  await assert.rejects(() => parseImport(new Uint8Array([1, 2, 3])), /Cannot read/)
  await assert.rejects(() => parseChanged((book) => {
    const items = book.getWorksheet('Items')
    for (let i = 3; i <= 102; i++) items.getRow(i).values = ['REPORT-001', 'Repair', 'HVAC', 'Maintenance', 1]
  }), /cannot exceed 100/)
})
test('export preserves numeric amounts and treats formula-like text as plain text', async () => {
  const reports = [{ id: 'report-id', report_date: '2026-10-01', prev_balance: '5.25', cash_received: '100',
    submitted_by: 'Aftab', status: 'submitted', total_expenses: '1.25', outstanding_balance: '104',
    created_at: '2026-10-01T00:00:00Z', revision: 1,
    expense_items: [{ sno: 1, description: '=HYPERLINK("https://example.com")', section: 'HVAC', category: '+Example', amount: '1.25' }] }]
  const buffer = await exportBuffer(reports)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer)
  assert.equal(book.getWorksheet('Reports').getCell('C2').value, 5.25)
  assert.equal(book.getWorksheet('Items').getCell('E2').value, 1.25)
  assert.equal(book.getWorksheet('Items').getCell('B2').value, reports[0].expense_items[0].description)
  assert.equal(book.getWorksheet('Items').getCell('B2').type, ExcelJS.ValueType.String)
  await assert.rejects(() => parseImport(buffer), /database export/)
})

test('archive preflight rejects an excessive expanded size before parsing', async () => {
  const data = Buffer.from(await templateBuffer())
  const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(central >= 0)
  data.writeUInt32LE(21 * 1024 * 1024, central + 24)
  assert.throws(() => checkArchiveSize(data), /exceeds 20 MB/)
})
