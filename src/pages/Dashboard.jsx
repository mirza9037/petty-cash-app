import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

// ── Role-based approval rules ──────────────────────────────────────────────────
const ROLE_MAP = {
  'aftab@thi.com': 'creator',
  'idrees@thi.com': 'creator',
  'zeeshan@thi.com': 'hod',
  'arshad@thi.com': 'cfo',
}

const STATUS_BADGES = {
  draft: { bg: '#e8e8e8', color: '#666' },
  submitted: { bg: '#fef3cd', color: '#856404' },
  hod_approved: { bg: '#cce5ff', color: '#fff' },
  cfo_approved: { bg: '#d4edda', color: '#fff' },
}

const STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  hod_approved: 'HOD Approved',
  cfo_approved: 'CFO Approved',
}

// ── Format helpers ─────────────────────────────────────────────────────────────
const fmt = (n) => {
  const num = Number(n) || 0
  return 'PKR ' + num.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function Dashboard({ user }) {
  const navigate = useNavigate()
  const userEmail = user?.email?.toLowerCase() || ''

  // ── State ────────────────────────────────────────────────────────────────────
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [approvingId, setApprovingId] = useState(null)

  // ── Fetch reports ────────────────────────────────────────────────────────────
  const fetchReports = async () => {
    const { data, error } = await supabase
      .from('expense_reports')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) setReports(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchReports()
  }, [])

  // ── Summary calculations ─────────────────────────────────────────────────────
  const totalOutstanding = useMemo(
    () => reports.reduce((sum, r) => sum + (parseFloat(r.outstanding_balance) || 0), 0),
    [reports],
  )

  const pendingApprovals = useMemo(
    () => reports.filter((r) => r.status === 'submitted' || r.status === 'hod_approved').length,
    [reports],
  )

  const totalThisMonth = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    return reports
      .filter((r) => {
        if (!r.report_date) return false
        const d = new Date(r.report_date)
        return d.getFullYear() === y && d.getMonth() === m
      })
      .reduce((sum, r) => sum + (parseFloat(r.total_expenses) || 0), 0)
  }, [reports])

  // ── Approval handler ────────────────────────────────────────────────────────
  const handleApprove = async (reportId, newStatus) => {
    setApprovingId(reportId)
    const { error } = await supabase
      .from('expense_reports')
      .update({ status: newStatus })
      .eq('id', reportId)

    if (!error) {
      await fetchReports()
    }
    setApprovingId(null)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        .dash-page {
          min-height: 100vh;
          background: #f9f9f9;
          font-family: 'Montserrat', 'Segoe UI', system-ui, sans-serif;
        }
        .dash-main {
          max-width: 1200px;
          margin: 0 auto;
          padding: 28px 24px 48px;
        }
        .dash-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .dash-title {
          font-size: 20px;
          font-weight: 800;
          color: #111;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0;
        }
        .dash-new-btn {
          padding: 10px 22px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          background: #D21515;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-family: 'Montserrat', system-ui, sans-serif;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background 0.18s, transform 0.12s;
          box-shadow: 0 2px 12px rgba(210,21,21,0.25);
        }
        .dash-new-btn:hover {
          background: #a81010;
          transform: translateY(-1px);
        }
        .dash-new-btn:active { transform: translateY(0); }

        /* ── Summary Cards ── */
        .dash-cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-bottom: 28px;
          animation: fadeIn 0.35s ease-out;
        }
        @media (max-width: 700px) {
          .dash-cards { grid-template-columns: 1fr; }
        }
        .dash-card {
          background: #fff;
          border: 1px solid #e5e5e5;
          border-radius: 10px;
          padding: 22px 24px;
          transition: box-shadow 0.2s, transform 0.15s;
        }
        .dash-card:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,0.06);
          transform: translateY(-2px);
        }
        .dash-card-value {
          font-size: 24px;
          font-weight: 800;
          color: #111;
          margin: 0 0 4px;
          letter-spacing: -0.3px;
        }
        .dash-card-label {
          font-size: 11px;
          font-weight: 700;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin: 0;
        }

        /* ── Table ── */
        .dash-table-wrap {
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 10px;
          overflow: hidden;
          animation: fadeIn 0.4s ease-out;
        }
        .dash-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .dash-table th {
          background: #111;
          color: #fff;
          padding: 12px 14px;
          text-align: left;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .dash-table td {
          padding: 12px 14px;
          border-bottom: 1px solid #f0f0f0;
          vertical-align: middle;
          color: #333;
        }
        .dash-table tbody tr {
          transition: background 0.12s;
        }
        .dash-table tbody tr:hover {
          background: #fafafa;
        }
        .dash-table tbody tr:nth-child(even) {
          background: #fdfdfd;
        }
        .dash-table tbody tr:nth-child(even):hover {
          background: #f5f5f5;
        }
        .dash-table .dash-row-clickable {
          cursor: pointer;
        }

        /* ── Status badge ── */
        .dash-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          white-space: nowrap;
        }

        /* ── Action buttons ── */
        .dash-actions {
          display: flex;
          gap: 6px;
          flex-wrap: nowrap;
        }
        .dash-act-btn {
          padding: 6px 14px;
          font-size: 11px;
          font-weight: 700;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-family: 'Montserrat', system-ui, sans-serif;
          transition: background 0.15s, transform 0.1s;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          white-space: nowrap;
        }
        .dash-act-btn:active { transform: translateY(0); }
        .dash-act-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .dash-act-view {
          background: #f0f0f0;
          color: #333;
        }
        .dash-act-view:hover:not(:disabled) { background: #e4e4e4; }
        .dash-act-edit {
          background: #333;
          color: #fff;
        }
        .dash-act-edit:hover:not(:disabled) { background: #555; }
        .dash-act-hod {
          background: #0d6efd;
          color: #fff;
          box-shadow: 0 1px 6px rgba(13,110,253,0.25);
        }
        .dash-act-hod:hover:not(:disabled) { background: #0b5ed7; transform: translateY(-1px); }
        .dash-act-cfo {
          background: #198754;
          color: #fff;
          box-shadow: 0 1px 6px rgba(25,135,84,0.25);
        }
        .dash-act-cfo:hover:not(:disabled) { background: #157347; transform: translateY(-1px); }

        .dash-spinner {
          width: 12px; height: 12px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }

        /* ── Loading / empty ── */
        .dash-loading {
          text-align: center;
          padding: 48px 24px;
          color: #888;
          font-size: 14px;
        }
        .dash-empty {
          text-align: center;
          padding: 48px 24px;
          color: #888;
          font-size: 14px;
        }

        .dash-table-overflow {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
      `}</style>

      <div className="dash-page">
        <Navbar user={user} />

        <div className="dash-main">
          <div className="dash-header">
            <h1 className="dash-title">Dashboard</h1>
            <button className="dash-new-btn" onClick={() => navigate('/report/new')}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New Report
            </button>
          </div>

          {/* ═══════════ SUMMARY CARDS ═══════════ */}
          <div className="dash-cards">
            <div className="dash-card">
              <p className="dash-card-value">{fmt(totalOutstanding)}</p>
              <p className="dash-card-label">Total Outstanding Balance</p>
            </div>
            <div className="dash-card">
              <p className="dash-card-value">{pendingApprovals}</p>
              <p className="dash-card-label">Pending Approvals</p>
            </div>
            <div className="dash-card">
              <p className="dash-card-value">{fmt(totalThisMonth)}</p>
              <p className="dash-card-label">Total Expenses This Month</p>
            </div>
          </div>

          {/* ═══════════ REPORTS TABLE ═══════════ */}
          <div className="dash-table-wrap">
            {loading ? (
              <div className="dash-loading">Loading reports…</div>
            ) : reports.length === 0 ? (
              <div className="dash-empty">
                No expense reports yet. Create your first report to get started.
              </div>
            ) : (
              <div className="dash-table-overflow">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th style={{ width: 55 }}>S.No</th>
                      <th style={{ width: 110 }}>Date</th>
                      <th>Submitted By</th>
                      <th style={{ textAlign: 'right' }}>Total Expenses (PKR)</th>
                      <th style={{ textAlign: 'right' }}>Outstanding Balance (PKR)</th>
                      <th style={{ width: 130 }}>Status</th>
                      <th style={{ width: 220 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report, idx) => {
                      const badgeStyle = STATUS_BADGES[report.status] || STATUS_BADGES.draft
                      const isApproving = approvingId === report.id

                      // Determine which action buttons to show
                      const showEdit =
                        report.status === 'draft' &&
                        (userEmail === 'aftab@thi.com' || userEmail === 'idrees@thi.com')
                      const showHodApprove =
                        report.status === 'submitted' && userEmail === 'zeeshan@thi.com'
                      const showCfoApprove =
                        report.status === 'hod_approved' && userEmail === 'arshad@thi.com'

                      return (
                        <tr key={report.id}>
                          <td style={{ textAlign: 'center', fontWeight: 700, color: '#999' }}>
                            {idx + 1}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {report.report_date
                              ? new Date(report.report_date + 'T00:00:00').toLocaleDateString('en-GB', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : '—'}
                          </td>
                          <td style={{ fontWeight: 600 }}>{report.submitted_by || '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'Montserrat', monospace" }}>
                            {fmt(report.total_expenses)}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: "'Montserrat', monospace", fontWeight: 600 }}>
                            {fmt(report.outstanding_balance)}
                          </td>
                          <td>
                            <span
                              className="dash-badge"
                              style={{ background: badgeStyle.bg, color: badgeStyle.color }}
                            >
                              {STATUS_LABELS[report.status] || report.status}
                            </span>
                          </td>
                          <td>
                            <div className="dash-actions">
                              <button
                                className="dash-act-btn dash-act-view"
                                onClick={() => navigate(`/report/${report.id}`)}
                              >
                                View
                              </button>

                              {showEdit && (
                                <button
                                  className="dash-act-btn dash-act-edit"
                                  onClick={() => navigate(`/report/${report.id}`)}
                                >
                                  Edit
                                </button>
                              )}

                              {showHodApprove && (
                                <button
                                  className="dash-act-btn dash-act-hod"
                                  disabled={isApproving}
                                  onClick={() => handleApprove(report.id, 'hod_approved')}
                                >
                                  {isApproving && <span className="dash-spinner" />}
                                  {isApproving ? 'Approving…' : 'HOD Approve'}
                                </button>
                              )}

                              {showCfoApprove && (
                                <button
                                  className="dash-act-btn dash-act-cfo"
                                  disabled={isApproving}
                                  onClick={() => handleApprove(report.id, 'cfo_approved')}
                                >
                                  {isApproving && <span className="dash-spinner" />}
                                  {isApproving ? 'Approving…' : 'CFO Approve'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
