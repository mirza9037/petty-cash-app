import { parseImport } from './excel.js'
self.onmessage = async ({ data }) => {
  try { self.postMessage({ reports: await parseImport(data) }) }
  catch (error) { self.postMessage({ error: error.message }) }
}
