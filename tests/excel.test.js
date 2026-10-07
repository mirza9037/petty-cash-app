import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { templateBuffer, parseImport, importPayload, exportBuffer, MAX_FILE_BYTES, checkArchiveSize, REPORT_COLUMNS, ITEM_COLUMNS } from '../src/lib/excel.js'

async function workbook() {
  const book = new ExcelJS.Workbook()
  book.addWorksheet('Reports').addRows([REPORT_COLUMNS, ['REPORT-001', '2020-01-01', 0, 1000]])
  book.addWorksheet('Items').addRows([ITEM_COLUMNS, ['REPORT-001', 'Repair', 'Civil Works', 'Maintenance', 100]])
  return book
}
async function parseChanged(change) {
  const book = await workbook()
  change(book)
  return parseImport(await book.xlsx.writeBuffer())
}
test('legacy template still reads multiple reports, Excel dates and exact decimal amounts', async () => {
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
  assert.equal(first[0].header.status, 'historical')
  assert.equal(first[0].header.source_reference, 'REPORT-001')
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
    created_at: '2026-10-01T00:00:00Z', revision: 1, source_reference: 'OLD-VOUCHER-123',
    expense_items: [{ sno: 1, description: '=HYPERLINK("https://example.com")', section: 'HVAC', category: '+Example', amount: '1.25' }] }]
  const buffer = await exportBuffer(reports)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer)
  assert.equal(book.getWorksheet('Report Summary').getCell('C2').value, 5.25)
  assert.equal(book.getWorksheet('Petty Cash').getCell('H2').value, 1.25)
  assert.equal(book.getWorksheet('Petty Cash').getCell('E2').value, reports[0].expense_items[0].description)
  assert.equal(book.getWorksheet('Petty Cash').getCell('E2').type, ExcelJS.ValueType.String)
  const parsed = await parseImport(buffer)
  assert.equal(parsed[0].items[0].amount, 1.25)
  assert.equal(parsed[0].header.status, 'draft') // original approval status is never trusted on upload
  assert.equal((await importPayload(parsed, 'uploader'))[0].header.source_reference, 'OLD-VOUCHER-123')
})

test('simple template uses one sheet and groups expenses without repeating balances', async () => {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await templateBuffer())
  assert.equal(book.worksheets.length, 1)
  const sheet = book.getWorksheet('Petty Cash')
  sheet.addRow(['REPORT-001', null, null, null, 'Second expense', 'HVAC', 'Maintenance', 0.29])
  sheet.addRow(['OLD-002', new Date('2018-01-15T00:00:00Z'), 12.34, 20, 'Old repair', 'HVAC', 'Maintenance', 1.01])
  const reports = await parseImport(await book.xlsx.writeBuffer())
  assert.equal(reports.length, 2)
  assert.equal(reports[0].items.length, 2)
  assert.equal(reports[0].items[1].amount, 0.29)
  assert.equal(reports[1].header.report_date, '2018-01-15')
  sheet.getCell('C3').value = 999
  await assert.rejects(() => parseImportBuffer(book), /date and balances must match/)
})

test('flat imports reject inconsistent headers, formulas, bad dates and unknown columns', async () => {
  for (const [cell, value, message] of [
    ['H2', -1, /Petty Cash row 2: Amount cannot be negative/],
    ['H2', { formula: '1+1', result: 2 }, /formulas/],
    ['B2', '2026-02-30', /valid report date/],
    ['B2', '2099-01-01', /future/],
    ['I1', 'Unexpected', /unexpected column/],
  ]) {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await templateBuffer())
    book.getWorksheet('Petty Cash').getCell(cell).value = value
    const buffer = await book.xlsx.writeBuffer()
    await assert.rejects(() => parseImport(buffer), message)
  }
})

test('flat imports support several years and enforce report limits', async () => {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await templateBuffer())
  const sheet = book.getWorksheet('Petty Cash')
  for (let i = 1; i < 500; i++) sheet.addRow(['OLD-' + i, '2010-01-01', 0, 1000, 'Repair', 'HVAC', 'Maintenance', 10])
  assert.equal((await parseImport(await book.xlsx.writeBuffer())).length, 500)
  sheet.addRow(['OVER-LIMIT', '2010-01-01', 0, 1000, 'Repair', 'HVAC', 'Maintenance', 10])
  await assert.rejects(() => parseImportBuffer(book), /at most 500/)
})

async function parseImportBuffer(book) { return parseImport(await book.xlsx.writeBuffer()) }

test('archive preflight rejects an excessive expanded size before parsing', async () => {
  const data = Buffer.from(await templateBuffer())
  const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(central >= 0)
  data.writeUInt32LE(21 * 1024 * 1024, central + 24)
  assert.throws(() => checkArchiveSize(data), /exceeds 20 MB/)
})
