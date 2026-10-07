import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { groupItems, STATUS_LABELS, formatDate, eventLabel } from './domain.js'
import { formatMoney, sumMoney } from './money.js'

export function buildReportPdf(report, items, events = []) {
  const doc = new jsPDF({ format: 'a4', unit: 'mm' })
  const money = (value) => formatMoney(value, false)
  doc.setFontSize(16)
  doc.text('Tabba Heart Institute', 14, 19)
  doc.setFontSize(10)
  doc.text('FMES Department - Expense Report', 14, 26)
  doc.text('Status: ' + (STATUS_LABELS[report.status] || report.status), 14, 33)
  doc.setFontSize(8)
  doc.text('Report: ' + report.id, 14, 40)
  doc.setFontSize(10)
  doc.text('Date: ' + formatDate(report.report_date), 14, 48)
  doc.text('Submitted by: ' + report.submitted_by, 14, 55)
  const balances = [
    ['Opening balance', report.prev_balance],
    ['Cash received', report.cash_received],
    ['Expenses', report.total_expenses],
    ['Closing balance', report.outstanding_balance],
  ]
  balances.forEach(([label, value], index) =>
    doc.text(label + ': PKR ' + money(value), 14, 63 + index * 6),
  )
  let rowNumber = 0
  const body = groupItems(items).flatMap((group) => [
    ...group.items.map((item) => [
      String(++rowNumber),
      item.description,
      item.section,
      item.category,
      money(item.amount),
    ]),
    [
      {
        content: 'Subtotal - ' + group.name,
        colSpan: 4,
        styles: { fontStyle: 'bold', halign: 'right' },
      },
      money(sumMoney(group.items)),
    ],
  ])
  body.push([
    { content: 'Grand total', colSpan: 4, styles: { fontStyle: 'bold', halign: 'right' } },
    money(report.total_expenses),
  ])
  autoTable(doc, {
    startY: 90,
    margin: { top: 20, bottom: 18, left: 14, right: 14 },
    head: [['No.', 'Description', 'Section', 'Category', 'Amount (PKR)']],
    body,
    styles: { fontSize: 9, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 30, 30] },
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 65 },
      2: { cellWidth: 34 },
      3: { cellWidth: 34 },
      4: { cellWidth: 37, halign: 'right' },
    },
  })
  let y = doc.lastAutoTable.finalY + 12
  if (events.length) {
    if (y > 240) {
      doc.addPage()
      y = 20
    }
    autoTable(doc, {
      startY: y,
      margin: { top: 20, bottom: 18, left: 14, right: 14 },
      head: [['Action', 'Staff member', 'Time (Karachi)']],
      body: events.map((event) => [
        eventLabel(event),
        event.actor_name,
        new Date(event.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' }),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [60, 60, 60] },
      rowPageBreak: 'avoid',
    })
    y = doc.lastAutoTable.finalY + 20
  }
  if (y > 242) {
    doc.addPage()
    y = 30
  }
  doc.setFontSize(9)
  ;['Prepared by', 'HOD FMES', 'CFO'].forEach((title, index) => {
    const x = 14 + index * 62
    doc.line(x, y + 12, x + 50, y + 12)
    doc.text(title, x, y + 18)
  })
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFontSize(8)
    if (page > 1)
      doc.text('Expense report - ' + (STATUS_LABELS[report.status] || report.status), 14, 12)
    doc.text(report.id, 14, 288)
    doc.text(page + ' / ' + pages, 196, 288, { align: 'right' })
  }
  return doc
}
