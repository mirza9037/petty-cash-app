export function toPaisa(value) {
  const text = String(value).trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(text))
    throw new Error('Use a valid amount with at most two decimal places.')
  const [whole, fraction = ''] = text.replace('-', '').split('.')
  const paisa =
    (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (text.startsWith('-') ? -1 : 1)
  if (!Number.isSafeInteger(paisa) || Math.abs(paisa) > 99999999900)
    throw new Error('Amount exceeds 999,999,999.00.')
  return paisa
}
export function previewPaisa(value) {
  try {
    return toPaisa(value === '' ? 0 : value)
  } catch {
    return 0
  }
}
export const sumMoney = (items) =>
  items.reduce((total, item) => total + toPaisa(item.amount), 0) / 100
export const formatMoney = (value, currency = true) =>
  (currency ? 'PKR ' : '') +
  Number(value ?? 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
