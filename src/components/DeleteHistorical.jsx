import { useRef, useState } from 'react'
import { canDeleteHistorical } from '../lib/roles'
import { deleteHistorical, errorMessage } from '../lib/reports'

export default function DeleteHistorical({ user, report, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  if (!canDeleteHistorical(user, report)) return null

  const remove = async () => {
    if (inFlight.current || !window.confirm('Delete this historical record for all accounts? It will disappear from reports and Excel downloads. The current balance stays the same. This cannot be undone in the app.')) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try { await deleteHistorical(report); onDeleted() }
    catch (failure) { setError(errorMessage(failure) + ' Reload to check its current status, or retry safely.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  return <div>
    <button className="secondary-button" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete historical record'}</button>
    {error && <p role="alert" className="error-banner">{error}</p>}
  </div>
}
