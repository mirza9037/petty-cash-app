export const SECTIONS = ['Civil Works', 'HVAC', 'Mechanical', 'Carpenter', 'Outreach', 'Electrical']
export const STATUS_LABELS = {
  draft: 'Draft',
  historical: 'Historical record',
  submitted: 'Submitted',
  hod_approved: 'HOD Approved',
  cfo_approved: 'CFO Approved',
}
export const STATUS_BADGES = {
  draft: { bg: '#e8e8e8', color: '#555' },
  historical: { bg: '#ede8f7', color: '#594580' },
  submitted: { bg: '#fef3cd', color: '#856404' },
  hod_approved: { bg: '#cce5ff', color: '#004085' },
  cfo_approved: { bg: '#d4edda', color: '#155724' },
}
export function today(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type).value).join('-')
}
export const formatDate = (value) =>
  value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'
export function groupItems(items) {
  const groups = new Map()
  for (const item of items) {
    const name = item.section || 'Uncategorized'
    if (!groups.has(name)) groups.set(name, { name, items: [] })
    groups.get(name).items.push(item)
  }
  return [...groups.values()]
}
export function eventLabel(event) {
  if (event.to_status === 'historical') return 'Historical upload'
  return event.to_status === 'draft' && ['submitted', 'hod_approved', 'cfo_approved'].includes(event.from_status)
    ? 'Withdrawn from ' + STATUS_LABELS[event.from_status] + ' to Draft'
    : STATUS_LABELS[event.to_status] || event.to_status
}
export function currentApprover(report, events, status) {
  if (status === 'hod_approved' && !['hod_approved', 'cfo_approved'].includes(report.status)) return null
  if (status === 'cfo_approved' && report.status !== 'cfo_approved') return null
  const submission = Math.max(0, ...events.filter((e) => e.to_status === 'submitted').map((e) => e.revision))
  return events.filter((e) => e.to_status === status && e.revision > submission)
    .sort((a, b) => b.revision - a.revision)[0]?.actor_name || null
}
