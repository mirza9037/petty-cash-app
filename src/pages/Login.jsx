import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const C = {
  red: '#D21515',
  redDark: '#a81010',
  black: '#111111',
  darkGray: '#333333',
  midGray: '#666666',
  border: '#e0e0e0',
  inputBg: '#fafafa',
  white: '#ffffff',
  offWhite: '#f5f5f5',
  font: "'Montserrat', 'Segoe UI', system-ui, sans-serif",
}

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authError) {
        setError(
          authError.status === 400
            ? 'Invalid email or password. Please try again.'
            : 'Sign in is unavailable. Please try again.',
        )
        return
      }
      navigate('/dashboard')
    } catch {
      setError('Unable to connect. Please check your connection and retry.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="thi-page">
        {/* Top red stripe */}
        <div className="thi-stripe" />

        {/* Centered content */}
        <div className="thi-content">
          <div className="thi-card">
            {/* Header — white bg, real logo in natural colors */}
            <div className="thi-card-header">
              <img
                src="/tabba-logo.svg"
                alt="Tabba Heart Institute"
                className="thi-logo"
                onError={(e) => {
                  if (!e.target.dataset.triedPng) {
                    e.target.dataset.triedPng = '1'
                    e.target.src = '/tabba-favicon.png'
                  } else {
                    e.target.style.display = 'none'
                    document.getElementById('thi-logo-fallback').style.display = 'flex'
                  }
                }}
              />
              {/* Fallback logo */}
              <div
                id="thi-logo-fallback"
                style={{
                  display: 'none',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginBottom: '20px',
                  fontFamily: C.font,
                }}
              >
                <span style={{ color: C.red, fontSize: '36px', lineHeight: 1 }}>♥</span>
                <span style={{ fontWeight: '800', fontSize: '18px', color: C.black }}>
                  Tabba Heart
                  <br />
                  <span
                    style={{
                      fontSize: '10px',
                      letterSpacing: '3px',
                      color: C.red,
                      fontWeight: '700',
                    }}
                  >
                    INSTITUTE
                  </span>
                </span>
              </div>

              <div className="thi-card-title">Petty Cash Management</div>
              <div className="thi-card-sub">FMES Department</div>
            </div>

            {/* Form body */}
            <div className="thi-card-body">
              <div className="thi-section-label">
                <span>Staff Sign In</span>
                <div className="thi-section-line" />
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="thi-field">
                  <label htmlFor="email" className="thi-label">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@tabbaheart.org"
                    className="thi-input"
                  />
                </div>

                <div className="thi-field">
                  <label htmlFor="password" className="thi-label">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="thi-input"
                  />
                </div>

                <button type="submit" disabled={loading} className="thi-btn">
                  {loading && <span className="thi-spinner" />}
                  {loading ? 'Signing In…' : 'Sign In'}
                </button>
              </form>

              {error && (
                <div className="thi-error" role="alert">
                  ⚠ {error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom black footer */}
        <div className="thi-footer">
          © Tabba Heart Institute · Internal System · Authorized Personnel Only
        </div>
      </div>
    </>
  )
}
