// Build larger workbooks away from the UI thread so date controls and status
// messages stay responsive while several years of records are being prepared.
export function prepareWorkbook(reports, scope, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excelExport.worker.js', import.meta.url), { type: 'module' })
    const finish = (error, buffer) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (error) reject(error)
      else resolve(buffer)
    }
    const abort = () => finish(new Error('Download cancelled.'))
    const timer = setTimeout(() => finish(new Error('Download took too long. Try a smaller date range.')), 120000)
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.buffer)
    worker.onerror = () => finish(new Error('Unable to prepare Excel. Please try again.'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    worker.postMessage({ reports, scope })
  })
}
