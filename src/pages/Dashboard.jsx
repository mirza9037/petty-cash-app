import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { canEdit, canHodApprove, canCfoApprove } from '../lib/roles'
import { STATUS_BADGES, STATUS_LABELS } from '../lib/domain'
import { formatMoney as fmt } from '../lib/money'
import { loadSummary, errorMessage } from '../lib/reports'
import Navbar from '../components/Navbar'
import WithdrawReport from '../components/WithdrawReport'
import DeleteDraft from '../components/DeleteDraft'
const PAGE_SIZE = 25
export default function Dashboard({ user }) {
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [approvingId, setApprovingId] = useState(null)
  const [page, setPage] = useState(0)
  const [count, setCount] = useState(0)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [refresh, setRefresh] = useState(0)
  const sequence = useRef(0)
  const approval = useRef(false)
  const fetchReports = useCallback(async () => {
    const version = ++sequence.current
    setLoading(true)
    setError('')
    try {
      let query = supabase
        .from('expense_reports')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .order('id')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .retry(false)
      if (status) query = query.eq('status', status)
      if (search.trim())
        query = query.ilike('submitted_by', '%' + search.trim().replace(/[%_]/g, '') + '%')
      if (dateFrom) query = query.gte('report_date', dateFrom)
      if (dateTo) query = query.lte('report_date', dateTo)
      const [result, totals] = await Promise.all([query, loadSummary()])
      if (result.error) throw result.error
      if (version !== sequence.current) return
      setReports(result.data)
      setCount(result.count || 0)
      setSummary(totals)
    } catch (failure) {
      if (version === sequence.current) setError(errorMessage(failure))
    } finally {
      if (version === sequence.current) setLoading(false)
    }
  }, [page, status, search, dateFrom, dateTo])
  useEffect(() => {
    const timer = setTimeout(fetchReports, 200)
    // The ref is a request generation counter, not a DOM node. Invalidate late responses on cleanup.
    return () => {
      clearTimeout(timer)
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++
    }
  }, [fetchReports, refresh])
  const handleApprove = async (reportId, newStatus) => {
    if (approval.current) return
    approval.current = true
    setApprovingId(reportId)
    setActionError('')
    try {
      const report = reports.find((r) => r.id === reportId)
      const { data, error } = await supabase.rpc('approve_expense_report', {
        p_report_id: reportId,
        p_expected_revision: report.revision,
        p_status: newStatus,
      })
      if (error) throw error
      if (data?.id !== reportId || data.status !== newStatus)
        throw new Error('Approval returned no changed record')
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (failure) {
      setActionError(errorMessage(failure))
    } finally {
      approval.current = false
      setApprovingId(null)
    }
  }
  return (
    <>
      <div className="dash-page">
        <Navbar user={user} />

        <div className="dash-main">
          <div className="dash-header">
            <h1 className="dash-title">Dashboard</h1>
            <button className="secondary-button" onClick={() => navigate('/excel')}>Excel import / export</button>
            {canEdit(user) && (
              <button className="dash-new-btn" onClick={() => navigate('/report/new')}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New Report
              </button>
            )}
          </div>

          {/* ═══════════ SUMMARY CARDS ═══════════ */}
          <div className="dash-cards">
            <div className="dash-card">
              <p className="dash-card-value">
                {summary
                  ? summary.outstanding_balance === null
                    ? 'Not yet recorded'
                    : fmt(summary.outstanding_balance)
                  : '—'}
              </p>
              <p className="dash-card-label">Department Cash Balance</p>
            </div>
            <div className="dash-card">
              <p className="dash-card-value">{summary?.pending_approvals ?? '—'}</p>
              <p className="dash-card-label">Pending Approvals</p>
            </div>
            <div className="dash-card">
              <p className="dash-card-value">{summary ? fmt(summary.month_expenses) : '—'}</p>
              <p className="dash-card-label">Submitted Expenses This Month</p>
            </div>
          </div>

          <p className="helper-text">
            One shared department balance. Drafts are excluded from summary amounts. Summaries cover
            all reports.
          </p>
          {(error || actionError) && (
            <div role="alert" className="error-banner">
              {error || actionError} <button onClick={fetchReports}>Retry loading</button>
            </div>
          )}
          <div className="report-filters">
            <label>
              Status
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(0)
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Submitted by
              <input
                value={search}
                maxLength={100}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(0)
                }}
                placeholder="Search staff"
              />
            </label>
            <label>
              From date
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(0)
                }}
              />
            </label>
            <label>
              To date
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(0)
                }}
              />
            </label>
          </div>
          {/* Reports */}
          <div className="dash-table-wrap">
            {loading ? (
              <div className="dash-loading">Loading reports…</div>
            ) : error ? (
              <div className="dash-empty">Reports could not be refreshed. Please retry.</div>
            ) : reports.length === 0 ? (
              <div className="dash-empty">No reports match these filters.</div>
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
                      const showEdit = canEdit(user, report)
                      const showHodApprove = report.status === 'submitted' && canHodApprove(user)
                      const showCfoApprove = report.status === 'hod_approved' && canCfoApprove(user)

                      return (
                        <tr key={report.id}>
                          <td style={{ textAlign: 'center', fontWeight: 700, color: '#999' }}>
                            {page * PAGE_SIZE + idx + 1}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {report.report_date
                              ? new Date(report.report_date + 'T00:00:00').toLocaleDateString(
                                  'en-GB',
                                  {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  },
                                )
                              : '—'}
                          </td>
                          <td style={{ fontWeight: 600 }}>{report.submitted_by || '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: "'Montserrat', monospace" }}>
                            {fmt(report.total_expenses)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontFamily: "'Montserrat', monospace",
                              fontWeight: 600,
                            }}
                          >
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
                                  onClick={() => navigate(`/report/${report.id}/edit`)}
                                >
                                  Edit
                                </button>
                              )}
                              <WithdrawReport user={user} report={report} onWithdrawn={() => { setLoading(true); setRefresh((v) => v + 1) }} />
                              <DeleteDraft user={user} report={report} onDeleted={() => { setPage(0); setLoading(true); setRefresh((v) => v + 1) }} />

                              {showHodApprove && (
                                <button
                                  className="dash-act-btn dash-act-hod"
                                  disabled={approvingId !== null}
                                  onClick={() => handleApprove(report.id, 'hod_approved')}
                                >
                                  {isApproving && <span className="dash-spinner" />}
                                  {isApproving ? 'Approving…' : 'HOD Approve'}
                                </button>
                              )}

                              {showCfoApprove && (
                                <button
                                  className="dash-act-btn dash-act-cfo"
                                  disabled={approvingId !== null}
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
          <div className="pagination">
            <button disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page + 1} · {count} reports
            </span>
            <button
              disabled={(page + 1) * PAGE_SIZE >= count || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
