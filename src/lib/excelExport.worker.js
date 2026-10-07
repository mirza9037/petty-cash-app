import { exportBuffer } from './excel.js'
self.onmessage = async ({ data }) => {
  try {
    const buffer = await exportBuffer(data.reports, data.scope)
    self.postMessage({ buffer }, [buffer instanceof ArrayBuffer ? buffer : buffer.buffer])
  } catch (error) { self.postMessage({ error: error.message }) }
}
