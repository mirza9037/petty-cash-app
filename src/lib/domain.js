export const SECTIONS = ['Civil Works', 'HVAC', 'Mechanical', 'Carpenter', 'Outreach', 'Electrical']
export const STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  hod_approved: 'HOD Approved',
  cfo_approved: 'CFO Approved',
}
export const STATUS_BADGES = {
  draft: { bg: '#e8e8e8', color: '#555' },
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
