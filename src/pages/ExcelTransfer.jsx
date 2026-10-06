import { useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { canEdit } from '../lib/roles'
import { today } from '../lib/domain'
import { sumMoney, formatMoney } from '../lib/money'
import { loadExportReports, importReports, errorMessage } from '../lib/reports'
import { MAX_FILE_BYTES, templateBuffer, exportBuffer, downloadWorkbook, importPayload } from '../lib/excel'

export default function ExcelTransfer({ user }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(null)
  const [saved, setSaved] = useState([])
  const worker = useRef(null)
  const running = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; worker.current?.terminate() }
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
  return <div className="dash-page">
    <Navbar user={user} />
    <main className="dash-main excel-transfer">
      <h1>Excel import and export</h1>
      <Link to="/dashboard">Back to dashboard</Link>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <p role="status" aria-live="polite">{busy || notice}</p>
      <section className="nr-card">
        <h2 className="nr-card-head">Download database records</h2>
        <div className="nr-card-body">
          <p>Export all reports you can access, with their expense rows, balances, owners and approval statuses. Dashboard filters do not apply. Amounts are in PKR.</p>
          <button className="secondary-button" disabled={!!busy} onClick={() => run('Preparing export…', async () => {
            const reports = await loadExportReports()
            const buffer = await exportBuffer(reports)
            if (!alive.current) return
            downloadWorkbook(buffer, 'petty-cash-records-' + today() + '.xlsx')
            setNotice('Downloaded ' + reports.length + ' reports with their expense rows.')
          })}>Download Excel</button>
        </div>
      </section>
      {canEdit(user) ? <section className="nr-card">
        <h2 className="nr-card-head">Upload records as drafts</h2>
        <div className="nr-card-body">
          <p>Fill the Reports and Items sheets in the template, matching each expense to its Report Key. Replace the example data before uploading. You can import up to 50 reports with 100 expense rows each.</p>
          <p>All reports save together as drafts under your account. Review them and refresh the opening balance before submitting for approval. Uploading the same keys and contents again with your account reuses the earlier import. Changed contents or keys create new drafts.</p>
          <button className="secondary-button" disabled={!!busy} onClick={() => run('Preparing template…', async () => {
            const buffer = await templateBuffer()
            if (alive.current) downloadWorkbook(buffer, 'petty-cash-import-template.xlsx')
          })}>Download import template</button>
          <label className="excel-file-label" htmlFor="excel-upload">Choose Excel file (.xlsx, up to 2 MB)</label>
          <input id="excel-upload" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!!busy} onChange={chooseFile} />
          {preview && <div>
            <h3>Preview: {preview.filename}</h3>
            <p>{preview.reports.length} reports ready to import. Check the details below before saving.</p>
            {preview.reports.map((report) => <details className="excel-preview" key={report.key}>
              <summary>{report.key} · {report.header.report_date} · {report.items.length} expenses · {formatMoney(sumMoney(report.items))}</summary>
              <p>Opening balance: {formatMoney(report.header.prev_balance)} · Cash received: {formatMoney(report.header.cash_received)}</p>
              <div className="dash-table-overflow"><table className="dash-table">
                <thead><tr><th>Description</th><th>Section</th><th>Category</th><th>Amount (PKR)</th></tr></thead>
                <tbody>{report.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.section}</td><td>{item.category}</td><td>{formatMoney(item.amount, false)}</td></tr>)}</tbody>
              </table></div>
            </details>)}
            <button className="nr-btn nr-btn-submit" disabled={!!busy} onClick={() => run('Saving imported drafts…', async () => {
              let result
              try { result = await importReports(preview.payload) }
              catch (failure) { throw new Error(errorMessage(failure) + ' Retry this import or re-upload the unchanged workbook to recover safely without duplicates.') }
              if (!alive.current) return
              setSaved(result.map((report) => ({ ...report, key: preview.reports[preview.payload.findIndex((p) => p.report_id === report.id)].key })))
              setPreview(null)
              setNotice('Import complete. ' + result.length + ' reports are available. Previously imported reports were reused.')
            })}>Import {preview.reports.length} reports as drafts</button>
          </div>}
          {!!saved.length && <ul>{saved.map((report) => <li key={report.id}><Link to={'/report/' + report.id}>View {report.key}</Link></li>)}</ul>}
        </div>
      </section> : <p>Excel import is available to creator accounts. You can download the records above.</p>}
    </main>
  </div>
}
