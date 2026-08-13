import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

// ── Format helpers ─────────────────────────────────────────────────────────────
const fmt = (n) => {
  const num = Number(n) || 0
  return 'PKR ' + num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function ReportDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const printRef = useRef(null)

  // ── State ────────────────────────────────────────────────────────────────────
  const [report, setReport]       = useState(null)
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // ── Fetch data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      setFetchError('')
      const [reportRes, itemsRes] = await Promise.all([
        supabase.from('expense_reports').select('*').eq('id', id).single(),
        supabase.from('expense_items').select('*').eq('report_id', id).order('sno', { ascending: true }),
      ])

      if (reportRes.error) {
        setFetchError(`Failed to load report: ${reportRes.error.message}`)
      } else if (reportRes.data) {
        setReport(reportRes.data)
      }

      if (itemsRes.data) setItems(itemsRes.data)
      setLoading(false)
    }
    fetchData()
  }, [id])

  // ── Group items by section ───────────────────────────────────────────────────
  const groupedItems = useMemo(() => {
    const sections = []
    const sectionMap = {}

    items.forEach((item) => {
      const sec = item.section || 'Uncategorized'
      if (!sectionMap[sec]) {
        sectionMap[sec] = { name: sec, items: [], subtotal: 0 }
        sections.push(sectionMap[sec])
      }
      sectionMap[sec].items.push(item)
      sectionMap[sec].subtotal += parseFloat(item.amount) || 0
    })

    return sections
  }, [items])

  // ── PDF Export ───────────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    if (!printRef.current) {
      setExportError('Print area not ready. Please wait and try again.')
      return
    }
    setExporting(true)
    setExportError('')

    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')

      const pageWidth  = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 10
      const printableWidth = pageWidth - margin * 2

      const imgWidth  = printableWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      if (imgHeight <= pageHeight - margin * 2) {
        // Fits on a single page
        pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight)
      } else {
        // Multi-page: slice the canvas into page-height chunks
        const pxPerPage = ((pageHeight - margin * 2) / imgWidth) * canvas.width
        let yOffset = 0
        let page = 0

        while (yOffset < canvas.height) {
          if (page > 0) pdf.addPage()

          const sliceHeight = Math.min(pxPerPage, canvas.height - yOffset)
          const sliceCanvas = document.createElement('canvas')
          sliceCanvas.width  = canvas.width
          sliceCanvas.height = sliceHeight
          const ctx = sliceCanvas.getContext('2d')
          ctx.drawImage(
            canvas,
            0, yOffset, canvas.width, sliceHeight,
            0, 0,       canvas.width, sliceHeight,
          )

          const sliceImg       = sliceCanvas.toDataURL('image/png')
          const sliceImgHeight = (sliceHeight * imgWidth) / canvas.width
          pdf.addImage(sliceImg, 'PNG', margin, margin, imgWidth, sliceImgHeight)

          yOffset += sliceHeight
          page++
        }
      }

      const filename = `expense-report-${report?.report_date || 'unknown'}.pdf`
      pdf.save(filename)
    } catch (err) {
      console.error('PDF export failed:', err)
      setExportError('PDF export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Navbar user={user} />
        <div style={{
          padding: '48px 24px',
          textAlign: 'center',
          fontFamily: "'Montserrat', system-ui, sans-serif",
          color: '#888',
          fontSize: '14px',
        }}>
          <span style={{
            display: 'inline-block',
            width: 20, height: 20,
            border: '2px solid #ddd',
            borderTopColor: '#D21515',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
            marginRight: 10,
            verticalAlign: 'middle',
          }} />
          Loading report…
        </div>
      </>
    )
  }

  if (fetchError || !report) {
    return (
      <>
        <Navbar user={user} />
        <div style={{ padding: '48px 24px', textAlign: 'center', fontFamily: "'Montserrat', system-ui, sans-serif" }}>
          <p style={{ color: '#D21515', fontWeight: 600, fontSize: '14px', marginBottom: 16 }}>
            {fetchError || 'Report not found.'}
          </p>
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
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }

        .rd-page {
          min-height: 100vh;
          background: #f9f9f9;
          font-family: 'Montserrat', 'Segoe UI', system-ui, sans-serif;
        }
        .rd-main {
          max-width: 900px;
          margin: 0 auto;
          padding: 28px 24px 48px;
        }

        /* ── Top bar ── */
        .rd-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .rd-back-btn {
          padding: 8px 18px;
          font-size: 12px;
          font-weight: 700;
          font-family: 'Montserrat', system-ui, sans-serif;
          color: #333;
          background: #f0f0f0;
          border: 1.5px solid #ccc;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background 0.15s, border-color 0.15s;
        }
        .rd-back-btn:hover { background: #e4e4e4; border-color: #999; }

        .rd-export-btn {
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
        .rd-export-btn:hover:not(:disabled) { background: #a81010; transform: translateY(-1px); }
        .rd-export-btn:active:not(:disabled) { transform: translateY(0); }
        .rd-export-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .rd-spinner {
          width: 13px; height: 13px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }

        /* ── Export error ── */
        .rd-export-error {
          margin-bottom: 16px;
          padding: 10px 14px;
          background: #fff5f5;
          border: 1.5px solid #D21515;
          border-radius: 6px;
          color: #D21515;
          font-size: 13px;
          font-weight: 600;
        }

        /* ── Printable area ── */
        .rd-print {
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 10px;
          padding: 40px 36px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
        }
        @media (max-width: 600px) {
          .rd-print { padding: 24px 16px; }
        }

        /* ── Header section ── */
        .rd-header {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-bottom: 32px;
          padding-bottom: 24px;
          border-bottom: 2px solid #eee;
        }
        @media (max-width: 700px) {
          .rd-header { grid-template-columns: 1fr; }
        }

        .rd-org-name {
          font-size: 18px;
          font-weight: 800;
          color: #D21515;
          margin: 0 0 2px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .rd-org-dept {
          font-size: 13px;
          font-weight: 700;
          color: #555;
          margin: 0 0 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .rd-report-title {
          font-size: 16px;
          font-weight: 800;
          color: #111;
          margin: 0 0 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .rd-field-row {
          display: flex;
          gap: 6px;
          margin-bottom: 4px;
          font-size: 13px;
          color: #444;
        }
        .rd-field-label {
          font-weight: 700;
          color: #666;
          white-space: nowrap;
        }
        .rd-field-value {
          font-weight: 600;
          color: #111;
        }

        /* ── Right column summary ── */
        .rd-summary { text-align: right; }
        .rd-summary-row {
          display: flex;
          justify-content: flex-end;
          gap: 16px;
          margin-bottom: 6px;
          font-size: 13px;
          color: #444;
        }
        .rd-summary-label {
          font-weight: 600;
          color: #666;
        }
        .rd-summary-value {
          font-weight: 600;
          color: #111;
          font-family: 'Montserrat', monospace;
          min-width: 130px;
          text-align: right;
        }
        .rd-summary-value.bold {
          font-weight: 800;
          color: #D21515;
          font-size: 14px;
        }

        /* ── Items table ── */
        .rd-items-title {
          font-size: 11px;
          font-weight: 800;
          color: #333;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          margin: 0 0 12px;
        }
        .rd-table-wrap {
          overflow-x: auto;                /* FIX: was also setting overflow:hidden which cancelled this */
          -webkit-overflow-scrolling: touch;
          margin-bottom: 32px;
          border-radius: 6px;
          border: 1px solid #e0e0e0;
        }
        .rd-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .rd-table th {
          background: #111;
          color: #fff;
          padding: 10px 14px;
          text-align: left;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .rd-table td {
          padding: 9px 14px;
          border-bottom: 1px solid #f0f0f0;
          vertical-align: middle;
          color: #333;
        }
        .rd-table tbody tr:nth-child(even) td { background: #fafafa; }
        .rd-table tbody tr:nth-child(odd)  td { background: #fff; }

        /* Subtotal row */
        .rd-subtotal td {
          background: #f0f0f0 !important;
          font-weight: 700;
          font-size: 12px;
          color: #444;
          border-bottom: 2px solid #ddd;
        }
        /* Grand total row */
        .rd-grand-total td {
          background: #111 !important;
          color: #fff !important;
          font-weight: 800;
          font-size: 13px;
          border: none;
        }

        /* ── Signature section ── */
        .rd-signatures {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
          margin-top: 48px;
          padding-top: 24px;
        }
        @media (max-width: 700px) {
          .rd-signatures { grid-template-columns: 1fr; }
        }
        .rd-sig-block { text-align: center; }
        .rd-sig-line {
          width: 100%;
          height: 1px;
          background: #333;
          margin-bottom: 10px;
          margin-top: 48px;
        }
        .rd-sig-name {
          font-size: 13px;
          font-weight: 800;
          color: #111;
          margin: 0 0 2px;
        }
        .rd-sig-title {
          font-size: 11px;
          font-weight: 600;
          color: #666;
          margin: 0;
        }
      `}</style>

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
              disabled={exporting}
              onClick={handleExportPDF}
            >
              {exporting && <span className="rd-spinner" />}
              {exporting ? 'Exporting…' : '📄 Export PDF'}
            </button>
          </div>

          {/* Export error (shown outside printable area) */}
          {exportError && (
            <div className="rd-export-error">⚠ {exportError}</div>
          )}

          {/* ═══════════ PRINTABLE AREA ═══════════ */}
          <div id="report-printable" ref={printRef} className="rd-print">
            {/* ── Header: Two columns ── */}
            <div className="rd-header">
              {/* Left column */}
              <div>
                <p className="rd-org-name">Tabba Heart Institute</p>
                <p className="rd-org-dept">FMES Department</p>
                <p className="rd-report-title">Expense Report</p>
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
                <div className="rd-summary-row" style={{ marginTop: 6, paddingTop: 8, borderTop: '2px solid #eee' }}>
                  <span className="rd-summary-label" style={{ fontWeight: 800, color: '#111' }}>Outstanding Balance:</span>
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
                            <td style={{ textAlign: 'right', fontFamily: "'Montserrat', monospace" }}>
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
                <p className="rd-sig-name">Aftab Ahmed</p>
                <p className="rd-sig-title">Senior Manager FMES</p>
              </div>
              <div className="rd-sig-block">
                <div className="rd-sig-line" />
                <p className="rd-sig-name">Zeeshan Ahmed</p>
                <p className="rd-sig-title">HOD FMES</p>
              </div>
              <div className="rd-sig-block">
                <div className="rd-sig-line" />
                <p className="rd-sig-name">Arshad Ghaffar</p>
                <p className="rd-sig-title">CFO</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
