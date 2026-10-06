import ExcelJS from 'exceljs'
import { SECTIONS, today } from './domain.js'
import { reportSchema, lineItemSchema, validate } from './validation.js'
import { toPaisa, sumMoney } from './money.js'

export const REPORT_COLUMNS = ['Report Key', 'Report Date', 'Opening Balance (PKR)', 'Cash Received (PKR)']
export const ITEM_COLUMNS = ['Report Key', 'Description', 'Section', 'Category', 'Amount (PKR)']
export const MAX_FILE_BYTES = 2 * 1024 * 1024

// XLSX is a ZIP archive. Bound the declared expanded size before invoking the
// parser; parsing also runs in a disposable worker with a time limit.
export function checkArchiveSize(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break }
  }
  if (end < 0) throw new Error('Cannot read this workbook. Use an unencrypted .xlsx template.')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  let expanded = 0
  if (count > 1000) throw new Error('Workbook is too complex. Copy records into a clean template.')
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('Cannot read this workbook archive. Use a clean .xlsx template.')
    expanded += view.getUint32(offset + 24, true)
    if (expanded > 20 * 1024 * 1024) throw new Error('Expanded workbook exceeds 20 MB. Copy records into a clean template.')
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
}

function table(workbook, name, headers, rows, widths) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.addRow(headers)
  sheet.addRows(rows)
  sheet.columns.forEach((column, i) => { column.width = widths[i] || 22 })
  sheet.getRow(1).height = 32
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9B1616' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } }
  sheet.eachRow((row, index) => {
    if (index > 1) row.alignment = { vertical: 'top', wrapText: true }
  })
  return sheet
}

export async function templateBuffer() {
  const workbook = new ExcelJS.Workbook()
  const reports = table(workbook, 'Reports', REPORT_COLUMNS, [['REPORT-001', today(), 0, 1000]], [24, 18, 26, 26])
  const items = table(workbook, 'Items', ITEM_COLUMNS,
    [['REPORT-001', 'Replace this example expense', 'Civil Works', 'Maintenance', 100]], [24, 56, 22, 24, 24])
  reports.getColumn(3).numFmt = reports.getColumn(4).numFmt = '#,##0.00'
  items.getColumn(5).numFmt = '#,##0.00'
  for (let row = 2; row <= 501; row++) {
    items.getCell(row, 3).dataValidation = { type: 'list', allowBlank: false,
      formulae: ['"' + SECTIONS.join(',') + '"'], showErrorMessage: true,
      error: 'Choose one of the listed sections.' }
  }
  table(workbook, 'Instructions', ['How to use this template'], [
    ['Replace the sample report and expense with your own records before uploading.'],
    ['Reports: one row per report. Items: one row per expense. Match Report Key in both sheets.'],
    ['Use a distinct Report Key for each report (for example a voucher number). Keep keys when retrying.'],
    ['Dates: YYYY-MM-DD or Excel dates. Amounts: numeric PKR, at most two decimal places; no formulas.'],
    ['Required: every column in Reports and Items. Sections: ' + SECTIONS.join(', ') + '.'],
    ['Limits: .xlsx files up to 2 MB, 50 reports per upload and 100 expense rows per report.'],
    ['Imported reports become drafts owned by the signed-in creator. Review and submit each for approval.'],
    ['The whole upload saves together. Re-uploading identical report keys and contents with the same account is safe.'],
    ['Changing a key or contents creates a new draft. Imports never update or delete existing records.'],
    ['Opening balances are historical input for drafts. Refresh the department balance before submitting.'],
    ['Database exports are for reference, not an import template. Copy wanted records into a fresh template.'],
  ], [110])
  return workbook.xlsx.writeBuffer()
}

function scalar(cell, location) {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value
  throw new Error(location + ': formulas, links and other special cells are not supported. Paste values only.')
}

function readRows(workbook, name, headers, maxRows) {
  const sheet = workbook.getWorksheet(name)
  if (!sheet) throw new Error('Missing ' + name + ' sheet. Use the downloadable template.')
  if (sheet.rowCount > maxRows + 1000 || sheet.columnCount > headers.length)
    throw new Error(name + ': too many rows or unexpected columns. Use a clean template.')
  headers.forEach((header, i) => {
    if (scalar(sheet.getCell(1, i + 1), name + ' header') !== header)
      throw new Error(name + ': column ' + (i + 1) + ' must be named “' + header + '”.')
  })
  const result = []
  sheet.eachRow((row, number) => {
    if (number === 1) return
    const values = headers.map((_, i) => scalar(row.getCell(i + 1), name + ' row ' + number))
    if (values.every((value) => value === '')) return
    if (result.length >= maxRows) throw new Error(name + ': too many records.')
    result.push({ values, number })
  })
  return result
}

function key(value, location) {
  if (!['string', 'number'].includes(typeof value) || !String(value).trim() || String(value).length > 100)
    throw new Error(location + ': enter a Report Key of 1–100 characters.')
  return String(value).trim()
}

export async function parseImport(buffer) {
  if (!buffer.byteLength || buffer.byteLength > MAX_FILE_BYTES) throw new Error('Choose an .xlsx file up to 2 MB.')
  checkArchiveSize(buffer)
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(buffer) } catch { throw new Error('Cannot read this workbook. Save an unencrypted .xlsx file using the template.') }
  if (workbook.getWorksheet('Export Info')) throw new Error('This is a database export. Copy records into the import template to create new drafts.')
  if (workbook.worksheets.some((s) => !['Reports', 'Items', 'Instructions'].includes(s.name)))
    throw new Error('Unexpected worksheet. Use only Reports, Items and Instructions from the template.')
  const reports = new Map()
  for (const { values: [rawKey, date, opening, received], number } of readRows(workbook, 'Reports', REPORT_COLUMNS, 50)) {
    const reportKey = key(rawKey, 'Reports row ' + number)
    if (reports.has(reportKey)) throw new Error('Reports row ' + number + ': duplicate Report Key ' + reportKey + '.')
    const header = validate(reportSchema, {
      report_date: date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : date,
      prev_balance: opening, cash_received: received, status: 'draft',
    })
    if (!header.success) throw new Error('Reports row ' + number + ': ' + header.error)
    reports.set(reportKey, { key: reportKey, header: header.data, items: [] })
  }
  if (!reports.size) throw new Error('Add at least one report to the Reports sheet.')
  for (const { values: [rawKey, description, section, category, amount], number } of readRows(workbook, 'Items', ITEM_COLUMNS, 5000)) {
    const reportKey = key(rawKey, 'Items row ' + number)
    const report = reports.get(reportKey)
    if (!report) throw new Error('Items row ' + number + ': unknown Report Key ' + reportKey + '.')
    const line = validate(lineItemSchema, { description, section, category, amount })
    if (!line.success) throw new Error('Items row ' + number + ': ' + line.error)
    report.items.push(line.data)
    if (report.items.length > 100) throw new Error(reportKey + ': cannot exceed 100 expense rows.')
  }
  for (const report of reports.values()) {
    if (!report.items.length) throw new Error(report.key + ': add at least one expense in Items.')
    const total = sumMoney(report.items)
    const closing = toPaisa(report.header.prev_balance) + toPaisa(report.header.cash_received) - Math.round(total * 100)
    if (total > 999999999 || Math.abs(closing) > 99999999900) throw new Error(report.key + ': total or closing balance exceeds the supported limit.')
  }
  return [...reports.values()]
}

async function stableId(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).slice(0, 16)
  bytes[6] = (bytes[6] & 15) | 80
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function importPayload(reports, userId) {
  return Promise.all(reports.map(async (report) => {
    const identity = 'petty-cash-excel-v1:' + userId + ':' + JSON.stringify(report)
    return { request_id: await stableId('request:' + identity), report_id: await stableId('report:' + identity),
      header: report.header, items: report.items }
  }))
}

export async function exportBuffer(reports) {
  const workbook = new ExcelJS.Workbook()
  const headers = [...REPORT_COLUMNS, 'Submitted By', 'Status', 'Total Expenses (PKR)', 'Closing Balance (PKR)', 'Created At', 'Revision']
  const reportSheet = table(workbook, 'Reports', headers, reports.map((r) => [r.id, r.report_date,
    Number(r.prev_balance), Number(r.cash_received), r.submitted_by, r.status, Number(r.total_expenses),
    Number(r.outstanding_balance), r.created_at, r.revision]), [40, 18, 26, 26, 26, 20, 26, 26, 28, 12])
  for (const col of [3, 4, 7, 8]) reportSheet.getColumn(col).numFmt = '#,##0.00'
  const itemSheet = table(workbook, 'Items', [...ITEM_COLUMNS, 'Line Number'], reports.flatMap((r) =>
    [...r.expense_items].sort((a, b) => a.sno - b.sno).map((item) => [r.id, item.description, item.section,
      item.category, Number(item.amount), item.sno])), [40, 56, 22, 24, 24, 16])
  itemSheet.getColumn(5).numFmt = '#,##0.00'
  table(workbook, 'Export Info', ['Field', 'Value'], [
    ['Exported at (UTC)', new Date().toISOString()], ['Currency', 'PKR'], ['Reports', reports.length],
    ['Scope', 'All reports accessible to your account; dashboard filters do not apply.'],
    ['Drafts', 'Included; draft balances do not affect the shared department balance.'],
    ['Balances', 'Opening and closing balances are per report. Do not add them across reports.'],
    ['Importing', 'Use the separate import template. Importing creates new drafts, not updates.'],
  ], [30, 105])
  return workbook.xlsx.writeBuffer()
}

export function downloadWorkbook(buffer, filename) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
