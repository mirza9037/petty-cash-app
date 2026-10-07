import { useRef, useState } from 'react'
import { canWithdraw } from '../lib/roles'
import { withdrawReport, errorMessage } from '../lib/reports'

export default function WithdrawReport({ user, report, onWithdrawn }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  if (!canWithdraw(user, report)) return null
  const withdraw = async () => {
    if (inFlight.current) return
    if (!window.confirm('Withdraw this report to Draft? Its effect on the department balance will be removed. Previous approvals will no longer apply. The submitted details and history will be kept. Only the latest report in the shared ledger can be withdrawn.')) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try { await withdrawReport(report); onWithdrawn() }
    catch (failure) { setError(errorMessage(failure) + ' Reload the report to check its current status, or retry safely.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div>
    <button className="secondary-button" disabled={busy} onClick={withdraw}>{busy ? 'Withdrawing…' : 'Withdraw to draft'}</button>
    {error && <p role="alert" className="error-banner">{error}</p>}
  </div>
}
