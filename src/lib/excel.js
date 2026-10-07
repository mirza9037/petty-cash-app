import ExcelJS from 'exceljs'
import { SECTIONS, STATUS_LABELS, today } from './domain.js'
import { reportSchema, lineItemSchema, validate } from './validation.js'
import { toPaisa, sumMoney } from './money.js'
import { boundedWorkbookArchive } from './xlsxArchive.js'
export { checkArchiveSize } from './xlsxArchive.js'

export const REPORT_COLUMNS = ['Report Key', 'Report Date', 'Opening Balance (PKR)', 'Cash Received (PKR)']
export const ITEM_COLUMNS = ['Report Key', 'Description', 'Section', 'Category', 'Amount (PKR)']
export const CASH_COLUMNS = ['Report Number', 'Report Date', 'Opening Balance (PKR)', 'Cash Received (PKR)',
  'Description', 'Section', 'Category', 'Amount (PKR)']
export const MAX_IMPORT_REPORTS = 500
export const MAX_IMPORT_ROWS = 10000
export const MAX_FILE_BYTES = 2 * 1024 * 1024

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
  const sheet = table(workbook, 'Petty Cash', CASH_COLUMNS,
    [['REPORT-001', today(), 0, 1000, 'Replace this example expense', 'Civil Works', 'Maintenance', 100]],
    [24, 18, 26, 26, 56, 22, 24, 24])
  for (const col of [3, 4, 8]) sheet.getColumn(col).numFmt = '#,##0.00'
  sheet.getCell('F2').dataValidation = { type: 'list', allowBlank: false,
      formulae: ['"' + SECTIONS.join(',') + '"'], showErrorMessage: true,
      error: 'Choose one of the listed sections.' }
  sheet.getCell('A1').note = 'Use the same report number for every expense in a report. Use a different number for each report.'
  sheet.getCell('B1').note = 'YYYY-MM-DD or an Excel date. Fill date and balances on the first row of each report; repeat them or leave them blank on later rows.'
  sheet.getCell('C1').note = 'Historical opening balance. Uploads do not change the current department balance.'
  sheet.getCell('H1').note = 'Numeric PKR with at most two decimals. Paste values rather than formulas.'
  return workbook.xlsx.writeBuffer()
}

function scalar(cell, location) {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value
  throw new Error(location + ': formulas, links and other special cells are not supported. Paste values only.')
}

function readRows(workbook, name, headers, maxRows, optionalHeaders = []) {
  const sheet = workbook.getWorksheet(name)
  if (!sheet) throw new Error('Missing ' + name + ' sheet. Use the downloadable template.')
  if (sheet.rowCount > maxRows + 1000 || sheet.columnCount > headers.length + optionalHeaders.length)
    throw new Error(name + ': too many rows or unexpected columns. Use a clean template.')
  headers.forEach((header, i) => {
    if (scalar(sheet.getCell(1, i + 1), name + ' header') !== header)
      throw new Error(name + ': column ' + (i + 1) + ' must be named “' + header + '”.')
  })
  for (let i = headers.length; i < sheet.columnCount; i++) {
    if (scalar(sheet.getCell(1, i + 1), name + ' header') !== optionalHeaders[i - headers.length])
      throw new Error(name + ': unexpected column. Use the downloadable template.')
  }
  const result = []
  sheet.eachRow((row, number) => {
    if (number === 1) return
    const values = Array.from({ length: sheet.columnCount }, (_, i) => scalar(row.getCell(i + 1), name + ' row ' + number))
    if (values.every((value) => value === '')) return
    if (result.length >= maxRows) throw new Error(name + ': too many records.')
    result.push({ values, number })
  })
  return result
}

function header(date, opening, received, location) {
  const result = validate(reportSchema, {
    report_date: date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : date,
    prev_balance: opening, cash_received: received, status: 'draft',
  })
  if (!result.success) throw new Error(location + ': ' + result.error)
  if (result.data.report_date > today()) throw new Error(location + ': historical report date cannot be in the future.')
  return result.data
}

function addItem(report, description, section, category, amount, location) {
  const line = validate(lineItemSchema, { description, section, category, amount })
  if (!line.success) throw new Error(location + ': ' + line.error)
  report.items.push(line.data)
  if (report.items.length > 100) throw new Error(report.key + ': cannot exceed 100 expense rows.')
}

const EXTRA_COLUMNS = ['Status', 'Recorded By', 'Report Expenses (PKR)', 'Closing Balance (PKR)', 'Original Reference']

function parseFlat(workbook) {
  const reports = new Map()
  for (const { values, number }
    of readRows(workbook, 'Petty Cash', CASH_COLUMNS, MAX_IMPORT_ROWS, EXTRA_COLUMNS)) {
    const [rawKey, date, opening, received, description, section, category, amount] = values
    const reference = values[12] === undefined || values[12] === '' ? '' : key(values[12], 'Petty Cash row ' + number)
    const location = 'Petty Cash row ' + number
    const reportKey = key(rawKey, location)
    let report = reports.get(reportKey)
    if (!report) {
      if (reports.size >= MAX_IMPORT_REPORTS) throw new Error('Upload at most 500 reports at a time. Split the workbook by year or month.')
      report = { key: reportKey, header: header(date, opening, received, location), items: [] }
      if (reference) report.reference = reference
      reports.set(reportKey, report)
    } else if ([date, opening, received].some((value) => value !== '')) {
      const repeated = header(date === '' ? report.header.report_date : date,
        opening === '' ? report.header.prev_balance : opening,
        received === '' ? report.header.cash_received : received, location)
      if (JSON.stringify(repeated) !== JSON.stringify(report.header))
        throw new Error(location + ': date and balances must match the first row for report ' + reportKey + '.')
    }
    if (reference && report.reference !== reference)
      throw new Error(location + ': original reference must match the first row for this report.')
    addItem(report, description, section, category, amount, location)
  }
  return reports
}

function key(value, location) {
  if (!['string', 'number'].includes(typeof value) || !String(value).trim() || String(value).length > 100)
    throw new Error(location + ': enter a report number of 1–100 characters.')
  return String(value).trim()
}

export async function parseImport(buffer) {
  if (!buffer.byteLength || buffer.byteLength > MAX_FILE_BYTES) throw new Error('Choose an .xlsx file up to 2 MB.')
  const bounded = boundedWorkbookArchive(buffer)
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(bounded) } catch { throw new Error('Cannot read this workbook. Save an unencrypted .xlsx file using the template.') }
  const flat = !!workbook.getWorksheet('Petty Cash')
  if (workbook.worksheets.some((s) => !(flat ? ['Petty Cash', 'Report Summary', 'Export Info'] : ['Reports', 'Items', 'Instructions']).includes(s.name)))
    throw new Error('Unexpected worksheet. Use the downloadable template or a current database export.')
  const reports = flat ? parseFlat(workbook) : new Map()
  if (!flat) for (const { values: [rawKey, date, opening, received], number } of readRows(workbook, 'Reports', REPORT_COLUMNS, MAX_IMPORT_REPORTS)) {
    const reportKey = key(rawKey, 'Reports row ' + number)
    if (reports.has(reportKey)) throw new Error('Reports row ' + number + ': duplicate Report Key ' + reportKey + '.')
    reports.set(reportKey, { key: reportKey, header: header(date, opening, received, 'Reports row ' + number), items: [] })
  }
  if (!reports.size) throw new Error('Add at least one report with expenses to the workbook.')
  if (!flat) for (const { values: [rawKey, description, section, category, amount], number } of readRows(workbook, 'Items', ITEM_COLUMNS, MAX_IMPORT_ROWS)) {
    const reportKey = key(rawKey, 'Items row ' + number)
    const report = reports.get(reportKey)
    if (!report) throw new Error('Items row ' + number + ': unknown Report Key ' + reportKey + '.')
    addItem(report, description, section, category, amount, 'Items row ' + number)
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
    const identity = 'petty-cash-history-v1:' + userId + ':' + JSON.stringify(report)
    return { request_id: await stableId('request:' + identity), report_id: await stableId('report:' + identity),
      header: { ...report.header, status: 'historical', source_reference: report.reference || report.key }, items: report.items }
  }))
}

export async function exportBuffer(reports, scope = 'All records') {
  const workbook = new ExcelJS.Workbook()
  const ordered = [...reports].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.id.localeCompare(b.id))
  const cash = table(workbook, 'Petty Cash', [...CASH_COLUMNS, ...EXTRA_COLUMNS], ordered.flatMap((r) =>
    [...r.expense_items].sort((a, b) => a.sno - b.sno).map((item, i) => [r.id, r.report_date,
      Number(r.prev_balance), Number(r.cash_received), item.description, item.section, item.category, Number(item.amount),
      STATUS_LABELS[r.status] || r.status, r.submitted_by, i === 0 ? Number(r.total_expenses) : null,
      i === 0 ? Number(r.outstanding_balance) : null, r.source_reference || ''])),
    [40, 18, 26, 26, 56, 22, 24, 24, 22, 26, 26, 26, 24])
  for (const col of [3, 4, 8, 11, 12]) cash.getColumn(col).numFmt = '#,##0.00'
  cash.getCell('C1').note = cash.getCell('D1').note = 'Report balance repeated per expense. Do not sum this column.'
  cash.getCell('H1').note = 'One expense per row. Sum this column for total spending.'
  const headers = [...REPORT_COLUMNS, 'Submitted By', 'Status', 'Total Expenses (PKR)', 'Closing Balance (PKR)', 'Created At', 'Revision']
  const reportSheet = table(workbook, 'Report Summary', headers, ordered.map((r) => [r.id, r.report_date,
    Number(r.prev_balance), Number(r.cash_received), r.submitted_by, STATUS_LABELS[r.status] || r.status, Number(r.total_expenses),
    Number(r.outstanding_balance), r.created_at, r.revision]), [40, 18, 26, 26, 26, 20, 26, 26, 28, 12])
  for (const col of [3, 4, 7, 8]) reportSheet.getColumn(col).numFmt = '#,##0.00'
  table(workbook, 'Export Info', ['Field', 'Value'], [
    ['Exported at (UTC)', new Date().toISOString()], ['Currency', 'PKR'], ['Reports', reports.length],
    ['Scope', scope],
    ['Historical records and drafts', 'Included. They do not affect the current shared department balance.'],
    ['Balances', 'Opening and closing balances are per report. Do not add them across reports.'],
    ['Importing', 'Upload the Petty Cash sheet to store historical copies. Existing records and approvals are never overwritten.'],
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
