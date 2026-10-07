import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { loadReport, errorMessage } from '../lib/reports'
import { groupItems, STATUS_LABELS, formatDate as fmtDate, currentApprover, eventLabel } from '../lib/domain'
import WithdrawReport from '../components/WithdrawReport'
import DeleteDraft from '../components/DeleteDraft'
import { formatMoney as fmt, sumMoney, toPaisa } from '../lib/money'
import { canEdit } from '../lib/roles'
const EMPTY = []
export default function ReportDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [resource, setResource] = useState(null)
  const [retry, setRetry] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const report = resource?.report
  const items = resource?.items || EMPTY
  const events = resource?.events || EMPTY
  const loading = resource?.id !== id
  const fetchError = resource?.error || ''
  useEffect(() => {
    const controller = new AbortController()
    loadReport(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResource({ id, ...data })
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResource({ id, error: errorMessage(error) })
      })
    return () => controller.abort()
  }, [id, retry])
  const groupedItems = useMemo(
    () =>
      groupItems(items).map((group) => {
        let subtotal
        try {
          subtotal = sumMoney(group.items)
        } catch {
          subtotal = NaN
        }
        return { ...group, subtotal }
      }),
    [items],
  )
  let reconciled = false
  try {
    reconciled =
      items.length > 0 &&
      items.length <= 100 &&
      toPaisa(sumMoney(items)) === toPaisa(report?.total_expenses) &&
      toPaisa(report.outstanding_balance) ===
        toPaisa(report.prev_balance) +
          toPaisa(report.cash_received) -
          toPaisa(report.total_expenses)
  } catch {
    /* Legacy data must be reviewed before export. */
  }
  const handleExportPDF = async () => {
    if (!reconciled || exporting) return
    setExporting(true)
    setExportError('')
    try {
      const { buildReportPdf } = await import('../lib/pdf')
      buildReportPdf(report, items, events).save(
        'expense-report-' + report.report_date + '-' + report.id.slice(0, 8) + '.pdf',
      )
    } catch {
      setExportError('PDF export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }
  const handleExportExcel = async () => {
    if (!reconciled || exporting) return
    setExporting(true)
    setExportError('')
    try {
      const [{ downloadWorkbook }, { prepareWorkbook }] = await Promise.all([import('../lib/excel'), import('../lib/excelDownload')])
      const buffer = await prepareWorkbook([{ ...report, expense_items: items }], 'Report ' + report.id)
      downloadWorkbook(buffer, 'petty-cash-report-' + report.report_date + '-' + report.id.slice(0, 8) + '.xlsx')
    } catch {
      setExportError('Excel download failed. Please try again.')
    } finally { setExporting(false) }
  }
  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Navbar user={user} />
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            fontFamily: "'Montserrat', system-ui, sans-serif",
            color: '#888',
            fontSize: '14px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 20,
              height: 20,
              border: '2px solid #ddd',
              borderTopColor: '#D21515',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              marginRight: 10,
              verticalAlign: 'middle',
            }}
          />
          Loading report…
        </div>
      </>
    )
  }

  if (fetchError || !report) {
    return (
      <>
        <Navbar user={user} />
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            fontFamily: "'Montserrat', system-ui, sans-serif",
          }}
        >
          <p
            role="alert"
            style={{ color: '#D21515', fontWeight: 600, fontSize: '14px', marginBottom: 16 }}
          >
            {fetchError || 'Report not found.'}
          </p>
          <button
            onClick={() => {
              setResource(null)
              setRetry((v) => v + 1)
            }}
          >
            Retry
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              padding: '8px 20px',
              background: '#111',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontFamily: "'Montserrat', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
      </>
    )
  }

  // ── Running S.No counter across all sections ──────────────────────────────────
  let globalSno = 0

  return (
    <>
      <div className="rd-page">
        <Navbar user={user} />

        <div className="rd-main">
          {/* ── Top bar (outside printable area) ── */}
          <div className="rd-topbar">
            <button className="rd-back-btn" onClick={() => navigate('/dashboard')}>
              ← Back to Dashboard
            </button>
            <button
              className="rd-export-btn"
              disabled={exporting || !reconciled}
              onClick={handleExportExcel}
            >Download Excel</button>
            <button
              className="rd-export-btn"
              disabled={exporting || !reconciled}
              onClick={handleExportPDF}
            >
              {exporting && <span className="rd-spinner" />}
              {exporting ? 'Exporting…' : '📄 Export PDF'}
            </button>
          </div>

          {canEdit(user, report) && (
            <button
              className="secondary-button"
              onClick={() => navigate('/report/' + id + '/edit')}
            >
              Edit draft
            </button>
          )}
          <WithdrawReport user={user} report={report} onWithdrawn={() => { setResource(null); setRetry((v) => v + 1) }} />
          <DeleteDraft user={user} report={report} onDeleted={() => navigate('/dashboard')} />
          {!reconciled && (
            <div className="error-banner" role="alert">
              This report has missing or inconsistent amounts. Export is disabled until an
              administrator reconciles it.
            </div>
          )}
          <p className="helper-text">
            Report {report.id} · {STATUS_LABELS[report.status] || report.status}
          </p>
          {report.status === 'historical' && <p className="helper-text">
            Uploaded past record{report.source_reference ? ' · Reference: ' + report.source_reference : ''}. This record does not affect the current shared balance or require approval.
          </p>}
          {/* Export error */}
          {exportError && (
            <div className="rd-export-error" role="alert">
              ⚠ {exportError}
            </div>
          )}

          {/* ═══════════ PRINTABLE AREA ═══════════ */}
          <div id="report-printable" className="rd-print">
            {/* ── Header: Two columns ── */}
            <div className="rd-header">
              {/* Left column */}
              <div>
                <p className="rd-org-name">Tabba Heart Institute</p>
                <p className="rd-org-dept">FMES Department</p>
                <p className="rd-report-title">
                  Expense Report — {STATUS_LABELS[report.status] || report.status}
                </p>
                <div className="rd-field-row">
                  <span className="rd-field-label">To:</span>
                  <span className="rd-field-value">Finance &amp; Accounts Department</span>
                </div>
                <div className="rd-field-row">
                  <span className="rd-field-label">From:</span>
                  <span className="rd-field-value">{report.submitted_by || '—'}</span>
                </div>
              </div>

              {/* Right column */}
              <div className="rd-summary">
                <div className="rd-summary-row">
                  <span className="rd-summary-label">Dated:</span>
                  <span className="rd-summary-value">{fmtDate(report.report_date)}</span>
                </div>
                <div className="rd-summary-row">
                  <span className="rd-summary-label">Balance as per previous report:</span>
                  <span className="rd-summary-value">{fmt(report.prev_balance)}</span>
                </div>
                <div className="rd-summary-row">
                  <span className="rd-summary-label">Amount Received:</span>
                  <span className="rd-summary-value">{fmt(report.cash_received)}</span>
                </div>
                <div className="rd-summary-row">
                  <span className="rd-summary-label">Less Expenses:</span>
                  <span className="rd-summary-value">{fmt(report.total_expenses)}</span>
                </div>
                <div
                  className="rd-summary-row"
                  style={{ marginTop: 6, paddingTop: 8, borderTop: '2px solid #eee' }}
                >
                  <span className="rd-summary-label" style={{ fontWeight: 800, color: '#111' }}>
                    Outstanding Balance:
                  </span>
                  <span className="rd-summary-value bold">{fmt(report.outstanding_balance)}</span>
                </div>
              </div>
            </div>

            {/* ── Line Items Table ── */}
            <p className="rd-items-title">Line Items</p>
            <div className="rd-table-wrap">
              <table className="rd-table">
                <thead>
                  <tr>
                    <th style={{ width: 55 }}>S.No</th>
                    <th>Description</th>
                    <th style={{ width: 150 }}>Section</th>
                    <th style={{ width: 130 }}>Category</th>
                    <th style={{ width: 140, textAlign: 'right' }}>Amount (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedItems.map((section) => (
                    <React.Fragment key={section.name}>
                      {section.items.map((item) => {
                        globalSno++
                        return (
                          <tr key={item.id}>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: '#999' }}>
                              {globalSno}
                            </td>
                            <td>{item.description || '—'}</td>
                            <td>{item.section || '—'}</td>
                            <td>{item.category || '—'}</td>
                            <td
                              style={{ textAlign: 'right', fontFamily: "'Montserrat', monospace" }}
                            >
                              {fmt(item.amount)}
                            </td>
                          </tr>
                        )
                      })}
                      {/* Section subtotal */}
                      <tr className="rd-subtotal">
                        <td></td>
                        <td colSpan={3} style={{ textAlign: 'right' }}>
                          Subtotal — {section.name}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: "'Montserrat', monospace" }}>
                          {fmt(section.subtotal)}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}

                  {/* Grand total */}
                  <tr className="rd-grand-total">
                    <td></td>
                    <td colSpan={3} style={{ textAlign: 'right', letterSpacing: '1px' }}>
                      GRAND TOTAL
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: "'Montserrat', monospace" }}>
                      {fmt(report.total_expenses)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Signature Section ── */}
            <div className="rd-signatures">
              <div className="rd-sig-block">
                <div className="rd-sig-line" />
                <p className="rd-sig-name">{report.submitted_by}</p>
                <p className="rd-sig-title">Prepared by</p>
              </div>
              <div className="rd-sig-block">
                <div className="rd-sig-line" />
                <p className="rd-sig-name">
                  {currentApprover(report, events, 'hod_approved') ||
                    (report.status === 'historical' ? 'Not recorded' : 'Awaiting approval')}
                </p>
                <p className="rd-sig-title">HOD FMES</p>
              </div>
              <div className="rd-sig-block">
                <div className="rd-sig-line" />
                <p className="rd-sig-name">
                  {currentApprover(report, events, 'cfo_approved') ||
                    (report.status === 'historical' ? 'Not recorded' : 'Awaiting approval')}
                </p>
                <p className="rd-sig-title">CFO</p>
              </div>
            </div>
          </div>
          {events.length > 0 && (
            <section className="audit-history">
              <h2>Report history</h2>
              <ol>
                {events.map((event) => (
                  <li key={event.id}>
                    {eventLabel(event)} by {event.actor_name} ·{' '}
                    {new Date(event.created_at).toLocaleString('en-GB', {
                      timeZone: 'Asia/Karachi',
                    })}{' '}
                    (Karachi)
                    {event.report_snapshot && <details>
                      <summary>Submitted details before withdrawal</summary>
                      <p>Date: {fmtDate(event.report_snapshot.report.report_date)} · Expenses: {fmt(event.report_snapshot.report.total_expenses)} · Opening: {fmt(event.report_snapshot.report.prev_balance)} · Cash received: {fmt(event.report_snapshot.report.cash_received)} · Closing: {fmt(event.report_snapshot.report.outstanding_balance)}</p>
                      <ul>{event.report_snapshot.items.map((item) => <li key={item.id}>{item.description} · {item.section} · {item.category} · {fmt(item.amount)}</li>)}</ul>
                    </details>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
