import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { canEdit } from '../lib/roles'
import { SECTIONS, today } from '../lib/domain'
import { previewPaisa, formatMoney } from '../lib/money'
import { reportSchema, lineItemsSchema, validate } from '../lib/validation'
import { loadReport, loadSummary, saveReport, errorMessage } from '../lib/reports'
import Navbar from '../components/Navbar'
const emptyRow = () => ({
  key: crypto.randomUUID(),
  description: '',
  section: SECTIONS[0],
  category: 'Maintenance',
  amount: '',
})
export default function NewReport({ user }) {
  const navigate = useNavigate()
  const { id } = useParams()
  const storageKey = 'petty-cash-pending-' + user.id + '-' + (id || 'new')
  const [pending] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey))
    } catch {
      return null
    }
  })
  const reportId = useRef(id || pending?.p_report_id || crypto.randomUUID())
  const request = useRef(pending)
  const revision = useRef(null)
  const [reportDate, setReportDate] = useState(pending?.p_header.report_date || today())
  const [prevBalance, setPrevBalance] = useState(pending?.p_header.prev_balance ?? '')
  const [cashReceived, setCashReceived] = useState(pending?.p_header.cash_received ?? '')
  const [items, setItems] = useState(
    pending?.p_items.map((row) => ({ ...row, key: crypto.randomUUID() })) || [emptyRow()],
  )
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [dirty, setDirty] = useState(Boolean(pending))
  const [hasLedger, setHasLedger] = useState(false)
  const inFlight = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([loadSummary(), id ? loadReport(id, controller.signal) : Promise.resolve(null)])
      .then(([summary, loaded]) => {
        if (controller.signal.aborted) return
        setHasLedger(summary.outstanding_balance !== null)
        if (loaded) {
          if (!(
            user.staffRole === 'creator' &&
            loaded.report.created_by === user.id &&
            loaded.report.status === 'draft'
          )) {
            setLoadError('This report is not an editable draft owned by your account.')
            return
          }
          reportId.current = id
          revision.current = loaded.report.revision
          setReportDate(loaded.report.report_date)
          setPrevBalance(loaded.report.prev_balance)
          setCashReceived(loaded.report.cash_received)
          setItems(loaded.items.map((row) => ({ ...row, key: row.id })))
        } else if (!pending) setPrevBalance(summary.outstanding_balance ?? '')
        setLoadError('')
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, user.id, user.staffRole, pending, retry])
  useEffect(() => {
    if (!dirty) return
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const leave = () => !dirty || window.confirm('Discard unsaved changes?')
  const totalExpenses = useMemo(
    () => items.reduce((sum, row) => sum + previewPaisa(row.amount), 0) / 100,
    [items],
  )
  const outstanding =
    (previewPaisa(prevBalance) + previewPaisa(cashReceived) - Math.round(totalExpenses * 100)) / 100
  const groupedRows = useMemo(() => {
    const groups = new Map()
    for (const row of items) {
      if (!groups.has(row.section)) groups.set(row.section, [])
      groups.get(row.section).push(row)
    }
    return [...groups].flatMap(([section, rows]) => [
      ...rows.map((row) => ({ type: 'item', row })),
      {
        type: 'subtotal',
        section,
        subtotal: rows.reduce((sum, row) => sum + previewPaisa(row.amount), 0) / 100,
      },
    ])
  }, [items])
  const updateItem = (key, field, value) =>
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  const addRow = () => {
    setDirty(true)
    setItems((rows) => (rows.length < 100 ? [...rows, emptyRow()] : rows))
  }
  const removeRow = (key) => {
    setDirty(true)
    setItems((rows) => (rows.length > 1 ? rows.filter((row) => row.key !== key) : rows))
  }
  const refreshBalance = async () => {
    try {
      const summary = await loadSummary()
      setPrevBalance(summary.outstanding_balance ?? '')
      setHasLedger(summary.outstanding_balance !== null)
      setDirty(true)
      setError('')
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  const handleSave = async (status) => {
    if (inFlight.current) return
    setError('')
    const header = validate(reportSchema, {
      report_date: reportDate,
      prev_balance: prevBalance === '' ? 0 : prevBalance,
      cash_received: cashReceived === '' ? 0 : cashReceived,
      status,
    })
    const lines = validate(lineItemsSchema, items)
    if (!header.success || !lines.success) {
      setError(header.error || lines.error)
      return
    }
    if (totalExpenses > 999999999 || Math.abs(outstanding) > 999999999) {
      setError('Report total or closing balance exceeds the supported limit.')
      return
    }
    const args = {
      p_report_id: reportId.current,
      p_expected_revision: revision.current,
      p_header: header.data,
      p_items: lines.data,
    }
    const fingerprint = JSON.stringify(args)
    if (request.current?.fingerprint !== fingerprint)
      request.current = { ...args, p_request_id: crypto.randomUUID(), fingerprint }
    const { fingerprint: _fingerprint, ...payload } = request.current
    inFlight.current = true
    setSaving(status)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(request.current))
      const saved = await saveReport(payload)
      sessionStorage.removeItem(storageKey)
      setDirty(false)
      navigate('/report/' + saved.id, { replace: true })
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      inFlight.current = false
      setSaving(null)
    }
  }
  const fmt = (value) => formatMoney(value, false)
  let globalSno = 0
  if (!canEdit(user))
    return (
      <>
        <Navbar user={user} />
        <main className="app-message" role="alert">
          Only creators can create and edit reports.
        </main>
      </>
    )
  if (loading || loadError)
    return (
      <>
        <Navbar user={user} />
        <main className="app-message">
          <p role={loadError ? 'alert' : undefined}>{loadError || 'Loading report…'}</p>
          {loadError && (
            <button
              onClick={() => {
                setLoading(true)
                setRetry((v) => v + 1)
              }}
            >
              Retry
            </button>
          )}
          <button onClick={() => navigate('/dashboard')}>Back to dashboard</button>
        </main>
      </>
    )
  return (
    <>
      <div className="nr-page">
        <Navbar user={user} beforeLeave={leave} />

        <div className="nr-main" onChangeCapture={() => setDirty(true)}>
          <fieldset disabled={saving !== null} className="report-fields">
            <h1 className="nr-title">{id ? 'Edit Draft' : 'New Expense Report'}</h1>
            <button
              className="secondary-button"
              onClick={() => {
                if (leave()) navigate('/dashboard')
              }}
            >
              Back to dashboard
            </button>

            {error && (
              <div className="nr-error" role="alert">
                ⚠ {error}
              </div>
            )}

            {/* ═══════════ HEADER SECTION ═══════════ */}
            <div className="nr-card">
              <div className="nr-card-head">Report Information</div>
              <div className="nr-card-body">
                <div className="nr-grid">
                  {/* Static fields */}
                  <div>
                    <label className="nr-label">Institution</label>
                    <div className="nr-static">Tabba Heart Institute</div>
                  </div>
                  <div>
                    <label className="nr-label">Department</label>
                    <div className="nr-static">FMES Department</div>
                  </div>
                  <div>
                    <label className="nr-label">To</label>
                    <div className="nr-static">Finance &amp; Accounts Department</div>
                  </div>
                  <div>
                    <label className="nr-label">Report Type</label>
                    <div className="nr-static">Expense Report</div>
                  </div>

                  {/* Editable fields */}
                  <div>
                    <label className="nr-label" htmlFor="nr-date">
                      Dated
                    </label>
                    <input
                      id="nr-date"
                      type="date"
                      className="nr-input"
                      value={reportDate}
                      onChange={(e) => setReportDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="nr-label" htmlFor="nr-submitted">
                      Submitted By
                    </label>
                    <input
                      id="nr-submitted"
                      className="nr-input"
                      value={user.displayName || user.email}
                      readOnly
                    />
                  </div>

                  <div>
                    <label className="nr-label">HOD</label>
                    <div className="nr-static">Zeeshan Ahmed</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══════════ BALANCE SUMMARY ═══════════ */}
            <div className="nr-card nr-balance">
              <div className="nr-card-head">Balance Summary</div>
              <div className="nr-card-body">
                <div className="nr-balance-grid">
                  <div className="nr-bal-row even">
                    <label htmlFor="opening-balance">Department opening balance</label>
                    <input
                      type="number"
                      className="nr-input"
                      style={{ width: 160, textAlign: 'right', flexShrink: 0 }}
                      placeholder="0.00"
                      id="opening-balance"
                      step="0.01"
                      readOnly={hasLedger}
                      value={prevBalance}
                      onChange={(e) => setPrevBalance(e.target.value)}
                    />
                  </div>
                  <button className="secondary-button" onClick={refreshBalance}>
                    Refresh opening balance
                  </button>
                  <div className="nr-bal-row odd">
                    <label htmlFor="cash-received">Amount Received (Petty Cash)</label>
                    <input
                      type="number"
                      className="nr-input"
                      style={{ width: 160, textAlign: 'right', flexShrink: 0 }}
                      placeholder="0.00"
                      id="cash-received"
                      step="0.01"
                      min="0"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                    />
                  </div>
                  <div className="nr-bal-row even">
                    <span>Less: Total Expenses</span>
                    <span className="nr-bal-val">PKR {fmt(totalExpenses)}</span>
                  </div>
                  <div className="nr-bal-row total">
                    <span>Outstanding Balance</span>
                    <span className="nr-bal-val">PKR {fmt(outstanding)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══════════ LINE ITEMS TABLE ═══════════ */}
            <div className="nr-card">
              <div className="nr-card-head">Line Items</div>
              <div className="nr-card-body" style={{ padding: '0' }}>
                <div className="nr-table-wrap">
                  <table className="nr-table">
                    <thead>
                      <tr>
                        <th style={{ width: 50 }}>S.No</th>
                        <th>Description</th>
                        <th style={{ width: 160 }}>Section</th>
                        <th style={{ width: 140 }}>Category</th>
                        <th style={{ width: 130 }}>Amount (PKR)</th>
                        <th style={{ width: 44 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedRows.map((entry) => {
                        if (entry.type === 'subtotal') {
                          return (
                            <tr key={`sub-${entry.section}`} className="nr-subtotal">
                              <td></td>
                              <td colSpan={3} style={{ textAlign: 'right' }}>
                                Subtotal — {entry.section}
                              </td>
                              <td style={{ textAlign: 'right' }}>PKR {fmt(entry.subtotal)}</td>
                              <td></td>
                            </tr>
                          )
                        }

                        const row = entry.row
                        globalSno++
                        return (
                          <tr key={row.key}>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: '#888' }}>
                              {globalSno}
                            </td>
                            <td>
                              <input
                                type="text"
                                className="nr-t-input"
                                placeholder="e.g. Pipe repair"
                                maxLength={500}
                                aria-label={'Description row ' + globalSno}
                                value={row.description}
                                onChange={(e) => updateItem(row.key, 'description', e.target.value)}
                              />
                            </td>
                            <td>
                              <select
                                className="nr-t-select"
                                aria-label={'Section row ' + globalSno}
                                value={row.section}
                                onChange={(e) => updateItem(row.key, 'section', e.target.value)}
                              >
                                {SECTIONS.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="text"
                                className="nr-t-input"
                                maxLength={100}
                                aria-label={'Category row ' + globalSno}
                                value={row.category}
                                onChange={(e) => updateItem(row.key, 'category', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                className="nr-t-input"
                                style={{ textAlign: 'right' }}
                                placeholder="0"
                                step="0.01"
                                min="0"
                                aria-label={'Amount row ' + globalSno}
                                value={row.amount}
                                onChange={(e) => updateItem(row.key, 'amount', e.target.value)}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                className="nr-remove-btn"
                                title="Remove row"
                                onClick={() => removeRow(row.key)}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        )
                      })}

                      {/* ── Grand total ── */}
                      <tr className="nr-grand-total">
                        <td></td>
                        <td colSpan={3} style={{ textAlign: 'right' }}>
                          GRAND TOTAL
                        </td>
                        <td style={{ textAlign: 'right' }}>PKR {fmt(totalExpenses)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ padding: '0 20px 20px' }}>
                  <button className="nr-add-row" disabled={items.length >= 100} onClick={addRow}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add Row
                  </button>
                </div>
              </div>
            </div>

            {/* ═══════════ ACTIONS ═══════════ */}
            <div className="nr-actions">
              <button
                className="nr-btn nr-btn-draft"
                disabled={saving !== null}
                onClick={() => handleSave('draft')}
              >
                {saving === 'draft' && <span className="nr-spinner" />}
                {saving === 'draft' ? 'Saving…' : 'Save as Draft'}
              </button>
              <button
                className="nr-btn nr-btn-submit"
                disabled={saving !== null}
                onClick={() => handleSave('submitted')}
              >
                {saving === 'submitted' && <span className="nr-spinner" />}
                {saving === 'submitted' ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </fieldset>
        </div>
      </div>
    </>
  )
}
