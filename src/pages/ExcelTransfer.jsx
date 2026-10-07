import { useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { canEdit } from '../lib/roles'
import { today } from '../lib/domain'
import { sumMoney, formatMoney } from '../lib/money'
import { loadExportReports, importReports, errorMessage } from '../lib/reports'
import { MAX_FILE_BYTES, templateBuffer, downloadWorkbook, importPayload } from '../lib/excel'
import { prepareWorkbook } from '../lib/excelDownload'

export default function ExcelTransfer({ user }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(null)
  const [saved, setSaved] = useState([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const worker = useRef(null)
  const running = useRef(false)
  const alive = useRef(true)
  const exportController = useRef(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; worker.current?.terminate(); exportController.current?.abort() }
  }, [])
  const run = async (label, operation) => {
    if (running.current) return
    running.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try { await operation() }
    catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : errorMessage(failure))
    } finally {
      running.current = false
      if (alive.current) setBusy('')
    }
  }
  const chooseFile = async (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    await run('Reading workbook…', async () => {
      setPreview(null)
      setSaved([])
      if (!/\.xlsx$/i.test(file.name) || !file.size || file.size > MAX_FILE_BYTES)
        throw new Error('Choose an .xlsx file up to 2 MB. Older .xls files must be saved as .xlsx first.')
      const buffer = await file.arrayBuffer()
      if (!alive.current) return
      const reports = await new Promise((resolve, reject) => {
        const parser = new Worker(new URL('../lib/excel.worker.js', import.meta.url), { type: 'module' })
        worker.current = parser
        const finish = (error, value) => {
          clearTimeout(timer)
          parser.terminate()
          worker.current = null
          if (error) reject(new Error(error))
          else resolve(value)
        }
        const timer = setTimeout(() => finish('Workbook took too long to read. Copy your records into a clean template.'), 15000)
        parser.onmessage = ({ data }) => finish(data.error, data.reports)
        parser.onerror = () => finish('Unable to read this workbook. Use a clean .xlsx template.')
        parser.postMessage(buffer, [buffer])
      })
      const payload = await importPayload(reports, user.id)
      if (alive.current) setPreview({ reports, payload, filename: file.name })
    })
  }
  const download = (all) => run('Preparing Excel download…', async () => {
    if (!all && (!from || !to || from > to)) throw new Error('Choose a start and end date in order.')
    const reports = await loadExportReports(undefined, all ? {} : { from, to })
    if (!reports.length) {
      setNotice(all ? 'There are no records to download yet.' : 'No reports found for these dates. Choose another date range.')
      return
    }
    if (!alive.current) return
    exportController.current = new AbortController()
    const buffer = await prepareWorkbook(reports, all ? 'All records' : from + ' to ' + to + ' (inclusive report dates)', exportController.current.signal)
    if (!alive.current) return
    downloadWorkbook(buffer, 'petty-cash-' + (all ? 'all-' + today() : from + '-to-' + to) + '.xlsx')
    setNotice('Downloaded ' + reports.length + (reports.length === 1 ? ' report' : ' reports') + ' with expense rows.')
  })
  return <div className="dash-page">
    <Navbar user={user} />
    <main className="dash-main excel-transfer">
      <h1>Petty cash Excel</h1>
      <p>Download your records or upload past petty-cash sheets. All amounts are in PKR.</p>
      <Link to="/dashboard">Back to dashboard</Link>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <p role="status" aria-live="polite">{busy || notice}</p>
      <section className="nr-card">
        <h2 className="nr-card-head">Download records</h2>
        <div className="nr-card-body">
          <p>Choose report dates, or download everything—including historical records, drafts and approval statuses.</p>
          <div className="report-filters">
            <label>From date<input type="date" value={from} disabled={!!busy} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To date<input type="date" value={to} min={from || undefined} disabled={!!busy} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <p className="helper-text">For a single day, use the same date in both fields. Each report also has its own Excel download button.</p>
          <div className="excel-actions">
            <button className="nr-btn nr-btn-submit" disabled={!!busy || !from || !to} onClick={() => download(false)}>Download selected dates</button>
            <button className="secondary-button" disabled={!!busy} onClick={() => download(true)}>Download all records</button>
          </div>
        </div>
      </section>
      {canEdit(user) ? <section className="nr-card">
        <h2 className="nr-card-head">Upload past records</h2>
        <div className="nr-card-body">
          <ol className="excel-steps">
            <li>Download the simple template and replace the example with your past expenses.</li>
            <li>Use one row per expense. Repeat the report number for expenses in the same report. Enter its date and balances on the first row.</li>
            <li>Choose the file, review the preview, then save it.</li>
          </ol>
          <p className="helper-text">Uploads are saved as historical records. Your current balance stays the same; past approvals are not recreated.</p>
          <button className="secondary-button" disabled={!!busy} onClick={() => run('Preparing template…', async () => {
            const buffer = await templateBuffer()
            if (alive.current) downloadWorkbook(buffer, 'petty-cash-import-template.xlsx')
          })}>Download simple template</button>
          <label className="excel-file-label" htmlFor="excel-upload">Choose Excel file (.xlsx, up to 2 MB)</label>
          <input id="excel-upload" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!!busy} onChange={chooseFile} />
          {preview && <div>
            <h3>Preview: {preview.filename}</h3>
            <p>Reports: {preview.reports.length} · Expenses: {preview.reports.reduce((n, r) => n + r.items.length, 0)}. Review before saving.</p>
            <p className="helper-text">Your current shared balance will stay the same. An unchanged upload under the same account is safe to retry. Changed data creates a new historical copy.</p>
            {preview.reports.slice(0, 20).map((report) => <details className="excel-preview" key={report.key}>
              <summary>{report.key} · {report.header.report_date} · {report.items.length} expenses · {formatMoney(sumMoney(report.items))}</summary>
              <p>Opening balance: {formatMoney(report.header.prev_balance)} · Cash received: {formatMoney(report.header.cash_received)}</p>
              <div className="dash-table-overflow"><table className="dash-table">
                <thead><tr><th>Description</th><th>Section</th><th>Category</th><th>Amount (PKR)</th></tr></thead>
                <tbody>{report.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.section}</td><td>{item.category}</td><td>{formatMoney(item.amount, false)}</td></tr>)}</tbody>
              </table></div>
            </details>)}
            {preview.reports.length > 20 && <p>Showing the first 20 reports. All {preview.reports.length} reports will be saved.</p>}
            <button className="nr-btn nr-btn-submit" disabled={!!busy} onClick={() => run('Saving historical records…', async () => {
              let result
              try { result = await importReports(preview.payload) }
              catch (failure) { throw new Error(errorMessage(failure) + ' Retry this import or re-upload the unchanged workbook to recover safely without duplicates.') }
              if (!alive.current) return
              setSaved(result.map((report) => ({ ...report, key: preview.reports[preview.payload.findIndex((p) => p.report_id === report.id)].key })))
              setPreview(null)
              setNotice('Import complete. ' + result.length + ' historical reports are available. Your current balance is unchanged.')
            })}>Save {preview.reports.length} historical {preview.reports.length === 1 ? 'report' : 'reports'}</button>
          </div>}
          {!!saved.length && <ul>{saved.map((report) => <li key={report.id}><Link to={'/report/' + report.id}>View {report.key}</Link></li>)}</ul>}
          <details className="excel-help"><summary>File format and larger datasets</summary>
            <p>Use the Petty Cash sheet in the template or a download from this page. The earlier Reports / Items template is also supported. Copy records from other layouts into the simple template and paste values instead of formulas.</p>
            <p>Upload up to 500 reports and 10,000 expense rows per file, with up to 100 expenses per report. Files must be .xlsx and at most 2 MB. For years of records, upload one month or year at a time. Stored records remain available across years.</p>
          </details>
        </div>
      </section> : <p>Excel import is available to creators and administrators. You can download the records above.</p>}
    </main>
  </div>
}
