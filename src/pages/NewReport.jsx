import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

const SECTIONS = ['Civil Works', 'HVAC', 'Mechanical', 'Carpenter', 'Outreach', 'Electrical']
const STAFF = [
  { name: 'Aftab Ahmed', email: 'aftab@thi.com' },
  { name: 'Idrees', email: 'idrees@thi.com' },
]

const today = () => new Date().toISOString().slice(0, 10)

const emptyRow = () => ({
  key: crypto.randomUUID(),
  description: '',
  section: SECTIONS[0],
  category: 'Maintenance',
  amount: '',
})

export default function NewReport({ user }) {
  const navigate = useNavigate()

  // ── Header fields ──
  const [reportDate, setReportDate] = useState(today())
  const [submittedBy, setSubmittedBy] = useState(STAFF[0].name)

  // ── Balance fields ──
  const [prevBalance, setPrevBalance] = useState('')
  const [cashReceived, setCashReceived] = useState('')

  // ── Line items ──
  const [items, setItems] = useState([emptyRow()])

  // ── UI state ──
  const [saving, setSaving] = useState(null) // 'draft' | 'submitted' | null
  const [error, setError] = useState('')

  // ── Calculations ──
  const totalExpenses = useMemo(
    () => items.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0),
    [items],
  )
  const outstanding = useMemo(
    () => (parseFloat(prevBalance) || 0) + (parseFloat(cashReceived) || 0) - totalExpenses,
    [prevBalance, cashReceived, totalExpenses],
  )

  // ── Section subtotals ──
  const sectionTotals = useMemo(() => {
    const map = {}
    items.forEach((r) => {
      if (!r.section) return
      map[r.section] = (map[r.section] || 0) + (parseFloat(r.amount) || 0)
    })
    return map
  }, [items])

  // ── Row helpers ──
  const updateItem = (key, field, value) =>
    setItems((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  const addRow = () => setItems((prev) => [...prev, emptyRow()])
  const removeRow = (key) => setItems((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev))

  // ── Save ──
  const handleSave = async (status) => {
    setError('')
    setSaving(status)

    const staffEntry = STAFF.find((s) => s.name === submittedBy) || STAFF[0]

    const reportPayload = {
      report_date: reportDate,
      submitted_by: staffEntry.name,
      hod: 'Zeeshan Ahmed',
      institution: 'Tabba Heart Institute',
      prev_balance: parseFloat(prevBalance) || 0,
      cash_received: parseFloat(cashReceived) || 0,
      total_expenses: totalExpenses,
      outstanding_balance: outstanding,
      status,
    }

    const { data: report, error: reportErr } = await supabase
      .from('expense_reports')
      .insert(reportPayload)
      .select()
      .single()

    if (reportErr) {
      setError(`Failed to save report: ${reportErr.message}`)
      setSaving(null)
      return
    }

    const itemPayloads = items.map((r, i) => ({
      report_id: report.id,
      sno: i + 1,
      description: r.description,
      section: r.section,
      category: r.category,
      amount: parseFloat(r.amount) || 0,
    }))

    const { error: itemsErr } = await supabase.from('expense_items').insert(itemPayloads)

    if (itemsErr) {
      setError(`Report saved but line items failed: ${itemsErr.message}`)
      setSaving(null)
      return
    }

    navigate('/dashboard')
  }

  // ── Format helpers ──
  const fmt = (n) =>
    Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }

        .nr-page {
          min-height: 100vh;
          background: #f9f9f9;
          font-family: 'Montserrat', 'Segoe UI', system-ui, sans-serif;
        }
        .nr-main {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 24px 48px;
        }

        /* ── Page title ── */
        .nr-title {
          font-size: 20px;
          font-weight: 800;
          color: #111;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0 0 24px;
        }

        /* ── Error banner ── */
        .nr-error {
          padding: 12px 16px;
          background: #fff5f5;
          border: 1.5px solid #D21515;
          border-radius: 6px;
          color: #D21515;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 20px;
        }

        /* ── Cards ── */
        .nr-card {
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          margin-bottom: 24px;
          overflow: hidden;
        }
        .nr-card-head {
          background: #111;
          color: #fff;
          padding: 12px 20px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }
        .nr-card-body { padding: 24px 20px; }

        /* ── Grid layouts ── */
        .nr-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px 24px;
        }
        .nr-grid-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 16px 24px;
        }
        @media (max-width: 700px) {
          .nr-grid, .nr-grid-3 { grid-template-columns: 1fr; }
        }

        /* ── Form fields ── */
        .nr-label {
          display: block;
          font-size: 10px;
          font-weight: 800;
          color: #666;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .nr-input, .nr-select {
          width: 100%;
          padding: 10px 12px;
          font-size: 13px;
          font-family: 'Montserrat', system-ui, sans-serif;
          color: #111;
          background: #fafafa;
          border: 1.5px solid #e0e0e0;
          border-radius: 5px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box;
        }
        .nr-input:focus, .nr-select:focus {
          border-color: #D21515;
          box-shadow: 0 0 0 3px rgba(210,21,21,0.08);
        }
        .nr-static {
          padding: 10px 12px;
          font-size: 13px;
          color: #333;
          background: #f0f0f0;
          border: 1.5px solid #e0e0e0;
          border-radius: 5px;
        }

        /* ── Balance summary ── */
        .nr-balance { background: #f7f7f7; }
        .nr-balance-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px 24px;
        }
        @media (max-width: 700px) {
          .nr-balance-grid { grid-template-columns: 1fr; }
        }
        .nr-bal-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          border-radius: 5px;
          font-size: 13px;
          font-weight: 600;
          color: #333;
        }
        .nr-bal-row.even { background: #fff; border: 1px solid #eee; }
        .nr-bal-row.odd  { background: #f0f0f0; }
        .nr-bal-row.total {
          background: #111;
          color: #fff;
          font-weight: 800;
          font-size: 14px;
          grid-column: 1 / -1;
        }
        .nr-bal-val { font-family: 'Montserrat', monospace; }

        /* ── Table ── */
        .nr-table-wrap {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .nr-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .nr-table th {
          background: #111;
          color: #fff;
          padding: 10px 12px;
          text-align: left;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .nr-table td {
          padding: 8px 10px;
          border-bottom: 1px solid #eee;
          vertical-align: middle;
        }
        .nr-table tr:nth-child(even) td { background: #f9f9f9; }
        .nr-table tr:nth-child(odd) td  { background: #fff; }

        .nr-table .nr-t-input {
          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          font-family: 'Montserrat', system-ui, sans-serif;
          border: 1.5px solid #e0e0e0;
          border-radius: 4px;
          background: transparent;
          outline: none;
          box-sizing: border-box;
        }
        .nr-table .nr-t-input:focus {
          border-color: #D21515;
          background: #fff;
        }
        .nr-table .nr-t-select {
          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          font-family: 'Montserrat', system-ui, sans-serif;
          border: 1.5px solid #e0e0e0;
          border-radius: 4px;
          background: transparent;
          outline: none;
          box-sizing: border-box;
        }
        .nr-table .nr-t-select:focus { border-color: #D21515; }

        .nr-remove-btn {
          background: none;
          border: none;
          color: #D21515;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: background 0.15s;
          line-height: 1;
        }
        .nr-remove-btn:hover { background: #fff0f0; }

        /* subtotal / grand total rows */
        .nr-subtotal td {
          background: #f0f0f0 !important;
          font-weight: 700;
          font-size: 12px;
          color: #444;
          border-bottom: 2px solid #ddd;
        }
        .nr-grand-total td {
          background: #111 !important;
          color: #fff !important;
          font-weight: 800;
          font-size: 13px;
          border: none;
        }

        /* ── Add row ── */
        .nr-add-row {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 14px;
          padding: 8px 18px;
          font-size: 12px;
          font-weight: 700;
          font-family: 'Montserrat', system-ui, sans-serif;
          color: #111;
          background: #f0f0f0;
          border: 1.5px solid #ccc;
          border-radius: 5px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .nr-add-row:hover { background: #e4e4e4; border-color: #999; }

        /* ── Action buttons ── */
        .nr-actions {
          display: flex;
          gap: 14px;
          margin-top: 8px;
          flex-wrap: wrap;
        }
        .nr-btn {
          padding: 12px 28px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-family: 'Montserrat', system-ui, sans-serif;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transition: background 0.18s, transform 0.12s, box-shadow 0.18s;
        }
        .nr-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .nr-btn-draft {
          background: #333;
          color: #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .nr-btn-draft:hover:not(:disabled) { background: #555; transform: translateY(-1px); }
        .nr-btn-submit {
          background: #D21515;
          color: #fff;
          box-shadow: 0 2px 12px rgba(210,21,21,0.25);
        }
        .nr-btn-submit:hover:not(:disabled) { background: #a81010; transform: translateY(-1px); }
        .nr-btn:active:not(:disabled) { transform: translateY(0); }

        .nr-spinner {
          width: 13px; height: 13px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }
      `}</style>

      <div className="nr-page">
        <Navbar user={user} />

        <div className="nr-main">
          <h1 className="nr-title">New Expense Report</h1>

          {error && <div className="nr-error">⚠ {error}</div>}

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
                  <label className="nr-label" htmlFor="nr-date">Dated</label>
                  <input
                    id="nr-date"
                    type="date"
                    className="nr-input"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="nr-label" htmlFor="nr-submitted">Submitted By</label>
                  <select
                    id="nr-submitted"
                    className="nr-select"
                    value={submittedBy}
                    onChange={(e) => setSubmittedBy(e.target.value)}
                  >
                    {STAFF.map((s) => (
                      <option key={s.email} value={s.name}>{s.name}</option>
                    ))}
                  </select>
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
                  <span>Balance as per Previous Report</span>
                  <input
                    type="number"
                    className="nr-input"
                    style={{ width: 140, textAlign: 'right' }}
                    placeholder="0.00"
                    value={prevBalance}
                    onChange={(e) => setPrevBalance(e.target.value)}
                  />
                </div>
                <div className="nr-bal-row odd">
                  <span>Amount Received (Petty Cash)</span>
                  <input
                    type="number"
                    className="nr-input"
                    style={{ width: 140, textAlign: 'right' }}
                    placeholder="0.00"
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
                    {items.map((row, idx) => (
                      <tr key={row.key}>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#888' }}>
                          {idx + 1}
                        </td>
                        <td>
                          <input
                            type="text"
                            className="nr-t-input"
                            placeholder="e.g. Pipe repair"
                            value={row.description}
                            onChange={(e) => updateItem(row.key, 'description', e.target.value)}
                          />
                        </td>
                        <td>
                          <select
                            className="nr-t-select"
                            value={row.section}
                            onChange={(e) => updateItem(row.key, 'section', e.target.value)}
                          >
                            {SECTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            className="nr-t-input"
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
                            value={row.amount}
                            onChange={(e) => updateItem(row.key, 'amount', e.target.value)}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="nr-remove-btn"
                            title="Remove row"
                            onClick={() => removeRow(row.key)}
                          >✕</button>
                        </td>
                      </tr>
                    ))}

                    {/* ── Section subtotals ── */}
                    {Object.entries(sectionTotals)
                      .filter(([, v]) => v > 0)
                      .map(([section, total]) => (
                        <tr key={`sub-${section}`} className="nr-subtotal">
                          <td></td>
                          <td colSpan={3} style={{ textAlign: 'right' }}>
                            Subtotal — {section}
                          </td>
                          <td style={{ textAlign: 'right' }}>PKR {fmt(total)}</td>
                          <td></td>
                        </tr>
                      ))}

                    {/* ── Grand total ── */}
                    <tr className="nr-grand-total">
                      <td></td>
                      <td colSpan={3} style={{ textAlign: 'right' }}>GRAND TOTAL</td>
                      <td style={{ textAlign: 'right' }}>PKR {fmt(totalExpenses)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ padding: '0 20px 20px' }}>
                <button className="nr-add-row" onClick={addRow}>
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
        </div>
      </div>
    </>
  )
}
