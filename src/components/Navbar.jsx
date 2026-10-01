import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Navbar({ user, beforeLeave }) {
  const navigate = useNavigate()

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const handleLogout = async () => {
    if (beforeLeave && !beforeLeave()) return
    setBusy(true)
    setError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      navigate('/login')
    } catch {
      setError('Sign out failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <nav className="thi-nav">
        <div className="thi-nav-left">
          <img
            src="/tabba-logo.svg"
            alt="Tabba Heart Institute"
            className="thi-nav-logo"
            onError={(e) => {
              if (!e.target.dataset.triedPng) {
                e.target.dataset.triedPng = '1'
                e.target.src = '/tabba-favicon.png'
              } else {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }
            }}
          />
          {/* Fallback */}
          <div className="thi-nav-logo-fallback">
            <span style={{ color: '#D21515', fontSize: '24px', lineHeight: 1 }}>♥</span>
            <span style={{ fontWeight: '800', fontSize: '15px', color: '#111111' }}>THI</span>
          </div>

          <div className="thi-nav-divider" />
          <span className="thi-nav-label">Petty Cash System</span>
        </div>

        <div className="thi-nav-right">
          {user?.email && (
            <span className="thi-nav-email" title={user.email}>
              {user.email}
            </span>
          )}
          <button className="thi-nav-logout" disabled={busy} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
