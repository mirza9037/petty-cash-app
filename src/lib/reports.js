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
