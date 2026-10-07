import { supabase } from './supabase.js'
export function errorMessage(error) {
  if (error?.code === 'PGRST202' || error?.code === '42P01')
    return 'Database setup is incomplete. Ask your administrator to apply the supplied migration.'
  if (error?.code === '42501') return 'Your account does not have permission for this action.'
  if (error?.code === '40001' || error?.code === 'P0001') return error.message
  return 'The request could not be completed. Check your connection and try again.'
}
export async function loadReport(id, signal) {
  const results = await Promise.all([
    supabase
      .from('expense_reports')
      .select('*')
      .eq('id', id)
      .single()
      .retry(false)
      .abortSignal(signal),
    supabase
      .from('expense_items')
      .select('*')
      .eq('report_id', id)
      .order('sno')
      .retry(false)
      .abortSignal(signal),
    supabase
      .from('report_events')
      .select('*')
      .eq('report_id', id)
      .order('created_at')
      .retry(false)
      .abortSignal(signal),
  ])
  const failed = results.find((result) => result.error)
  if (failed) throw failed.error
  return { report: results[0].data, items: results[1].data, events: results[2].data }
}
export async function loadSummary() {
  const { data, error } = await supabase.rpc('department_summary')
  if (error) throw error
  if (!data) throw new Error('No summary returned')
  return data
}
export async function saveReport(args) {
  const { data, error } = await supabase.rpc('save_expense_report', args)
  if (error) throw error
  if (!data?.id) throw new Error('Save response was incomplete')
  return data
}
export async function withdrawReport(report) {
  const { data, error } = await supabase.rpc('withdraw_expense_report', {
    p_report_id: report.id, p_expected_revision: report.revision,
  })
  if (error) throw error
  if (data?.id !== report.id || data.status !== 'draft' || data.revision !== report.revision + 1)
    throw new Error('Withdrawal response was incomplete')
  return data
}
export async function resolveSave(requestId, discard = false) {
  const { data, error } = await supabase.rpc('resolve_report_save', {
    p_request_id: requestId,
    p_discard: discard,
  })
  if (error) throw error
  if (!['saved', 'cancelled', 'unknown'].includes(data?.status) ||
      (data.status === 'saved' && !data.report_id)) throw new Error('Invalid recovery response')
  return data
}

// Keyset pagination avoids the API row limit and keeps each report with its
// items in one database statement. Never return a silently truncated export.
export async function loadExportReports(client = supabase) {
  const reports = []
  let after = null
  for (;;) {
    let query = client.from('expense_reports').select('*,expense_items(*)').order('id').limit(100).retry(false)
    if (after) query = query.gt('id', after)
    const { data, error } = await query
    if (error) throw error
    if (!Array.isArray(data) || data.some((row) => !Array.isArray(row.expense_items)))
      throw new Error('Export data is incomplete')
    if (!data.length) return reports
    if (after && data[0].id <= after) throw new Error('Export pagination did not advance')
    reports.push(...data)
    if (reports.length > 10000) throw new Error('Export exceeds 10,000 reports. Contact your administrator for a full export.')
    after = data[data.length - 1].id
    // Even a short page may reflect a server-configured cap, so fetch until empty.
  }
}

export async function importReports(payload) {
  const { data, error } = await supabase.rpc('import_expense_reports', { p_reports: payload })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== payload.length || data.some((r) => !r.id))
    throw new Error('Import response was incomplete')
  const expected = new Set(payload.map((report) => report.report_id))
  if (new Set(data.map((report) => report.id)).size !== expected.size || data.some((report) => !expected.has(report.id)))
    throw new Error('Import response did not match the selected reports')
  return data
}
