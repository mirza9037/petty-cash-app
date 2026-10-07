import { useRef, useState } from 'react'
import { canDeleteDraft } from '../lib/roles'
import { deleteDraft, errorMessage } from '../lib/reports'

export default function DeleteDraft({ user, report, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  if (!canDeleteDraft(user, report)) return null
  const remove = async () => {
    if (inFlight.current || !window.confirm('Delete this draft? It will be removed from the dashboard and Excel exports. This cannot be undone in the app. Its history will be retained in the database.')) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try { await deleteDraft(report); onDeleted() }
    catch (failure) { setError(errorMessage(failure) + ' Reload to check its current status, or retry safely.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div>
    <button className="secondary-button" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete draft'}</button>
    {error && <p role="alert" className="error-banner">{error}</p>}
  </div>
}
