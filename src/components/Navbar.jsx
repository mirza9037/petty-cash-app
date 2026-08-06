import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Navbar({ user }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');

        .thi-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 28px;
          height: 64px;
          background: #ffffff;
          border-bottom: 3px solid #D21515;
          position: sticky;
          top: 0;
          z-index: 100;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          font-family: 'Montserrat', 'Segoe UI', system-ui, sans-serif;
        }

        .thi-nav-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .thi-nav-logo {
          height: 46px;
          width: auto;
          display: block;
          object-fit: contain;
        }

        .thi-nav-divider {
          width: 1px;
          height: 30px;
          background: #e0e0e0;
        }

        .thi-nav-label {
          font-size: 11px;
          font-weight: 800;
          color: #333333;
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }

        .thi-nav-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .thi-nav-email {
          font-size: 12px;
          font-weight: 500;
          color: #666666;
          font-family: 'Montserrat', system-ui, sans-serif;
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .thi-nav-logout {
          padding: 8px 18px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          background: #D21515;
          color: #ffffff;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-family: 'Montserrat', system-ui, sans-serif;
          transition: background 0.18s, transform 0.12s;
          box-shadow: 0 2px 8px rgba(210,21,21,0.25);
        }
        .thi-nav-logout:hover {
          background: #a81010;
          transform: translateY(-1px);
        }
        .thi-nav-logout:active { transform: translateY(0); }

        .thi-nav-logo-fallback {
          display: none;
          align-items: center;
          gap: 8px;
          font-family: 'Montserrat', system-ui, sans-serif;
        }
      `}</style>

      <nav className="thi-nav">
        <div className="thi-nav-left">
          <img
            src="https://tabbaheart.org/wp-content/uploads/2023/07/tabba-heart-logo-01.svg"
            alt="Tabba Heart Institute"
            className="thi-nav-logo"
            onError={(e) => {
              if (!e.target.dataset.triedPng) {
                e.target.dataset.triedPng = '1'
                e.target.src = 'https://tabbaheart.org/wp-content/uploads/2025/09/tabba-heart-favicon0.png'
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
          <button className="thi-nav-logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>
    </>
  )
}
