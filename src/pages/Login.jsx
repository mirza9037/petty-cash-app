import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const C = {
  red:       '#D21515',
  redDark:   '#a81010',
  black:     '#111111',
  darkGray:  '#333333',
  midGray:   '#666666',
  border:    '#e0e0e0',
  inputBg:   '#fafafa',
  white:     '#ffffff',
  offWhite:  '#f5f5f5',
  font:      "'Montserrat', 'Segoe UI', system-ui, sans-serif",
}

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [focused, setFocused]   = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (authError) {
      setError('Invalid email or password. Please try again.')
    } else {
      navigate('/dashboard')
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .thi-page {
          min-height: 100vh;
          background-color: ${C.white};
          display: flex;
          flex-direction: column;
          font-family: ${C.font};
        }

        /* ── Top red stripe ── */
        .thi-stripe {
          height: 5px;
          background: ${C.red};
          width: 100%;
          flex-shrink: 0;
        }

        /* ── Content area ── */
        .thi-content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
        }

        /* ── Card ── */
        .thi-card {
          background: ${C.white};
          border: 1px solid ${C.border};
          border-top: 4px solid ${C.red};
          border-radius: 8px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          overflow: hidden;
        }

        /* ── Card header ── */
        .thi-card-header {
          background: ${C.white};
          padding: 36px 36px 24px;
          text-align: center;
          border-bottom: 1px solid ${C.border};
        }
        .thi-logo {
          height: 60px;
          width: auto;
          display: block;
          margin: 0 auto 20px;
        }
        .thi-card-title {
          font-size: 17px;
          font-weight: 800;
          color: ${C.black};
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .thi-card-sub {
          font-size: 11px;
          font-weight: 600;
          color: ${C.red};
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        /* ── Card body ── */
        .thi-card-body {
          padding: 32px 36px 36px;
        }

        .thi-section-label {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 24px;
        }
        .thi-section-label span {
          font-size: 10px;
          font-weight: 800;
          color: ${C.midGray};
          letter-spacing: 2px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .thi-section-line {
          flex: 1;
          height: 1px;
          background: ${C.border};
        }

        /* ── Fields ── */
        .thi-field { margin-bottom: 18px; }
        .thi-label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          color: ${C.black};
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 7px;
        }
        .thi-input {
          width: 100%;
          padding: 12px 14px;
          font-size: 14px;
          font-family: ${C.font};
          color: ${C.black};
          background: ${C.inputBg};
          border: 1.5px solid ${C.border};
          border-radius: 6px;
          outline: none;
          transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
        }
        .thi-input:focus {
          border-color: ${C.red};
          background: ${C.white};
          box-shadow: 0 0 0 3px rgba(210,21,21,0.10);
        }
        .thi-input::placeholder { color: #bbb; }

        /* ── Button ── */
        .thi-btn {
          width: 100%;
          padding: 13px;
          margin-top: 6px;
          background: ${C.red};
          color: ${C.white};
          font-family: ${C.font};
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.18s, transform 0.12s, box-shadow 0.18s;
          box-shadow: 0 4px 16px rgba(210,21,21,0.28);
        }
        .thi-btn:hover:not(:disabled) {
          background: ${C.redDark};
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(210,21,21,0.35);
        }
        .thi-btn:active:not(:disabled) { transform: translateY(0); }
        .thi-btn:disabled { opacity: 0.65; cursor: not-allowed; }

        /* ── Spinner ── */
        .thi-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          flex-shrink: 0;
        }

        /* ── Error ── */
        .thi-error {
          margin-top: 16px;
          padding: 11px 14px;
          border: 1.5px solid ${C.red};
          border-radius: 6px;
          background: #fff5f5;
          color: ${C.red};
          font-size: 13px;
          font-weight: 600;
          line-height: 1.5;
        }

        /* ── Footer strip ── */
        .thi-footer {
          background: ${C.black};
          color: rgba(255,255,255,0.5);
          text-align: center;
          padding: 14px 20px;
          font-size: 11px;
          font-family: ${C.font};
          letter-spacing: 0.5px;
        }
      `}</style>

      <div className="thi-page">
        {/* Top red stripe */}
        <div className="thi-stripe" />

        {/* Centered content */}
        <div className="thi-content">
          <div className="thi-card">

            {/* Header — white bg, real logo in natural colors */}
            <div className="thi-card-header">
              <img
                src="https://tabbaheart.org/wp-content/uploads/2023/07/tabba-heart-logo-01.svg"
                alt="Tabba Heart Institute"
                className="thi-logo"
                onError={(e) => {
                  e.target.style.display = 'none'
                  document.getElementById('thi-logo-fallback').style.display = 'flex'
                }}
              />
              {/* Fallback logo */}
              <div id="thi-logo-fallback" style={{
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginBottom: '20px',
                fontFamily: C.font,
              }}>
                <span style={{ color: C.red, fontSize: '36px', lineHeight: 1 }}>♥</span>
                <span style={{ fontWeight: '800', fontSize: '18px', color: C.black }}>
                  Tabba Heart<br />
                  <span style={{ fontSize: '10px', letterSpacing: '3px', color: C.red, fontWeight: '700' }}>INSTITUTE</span>
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
                  <label htmlFor="email" className="thi-label">Email Address</label>
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
                  <label htmlFor="password" className="thi-label">Password</label>
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

              {error && <div className="thi-error">⚠ {error}</div>}
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
