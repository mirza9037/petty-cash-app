import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'

export default function Dashboard({ user }) {
  const navigate = useNavigate()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');

        .dash-page {
          min-height: 100vh;
          background: #f9f9f9;
          font-family: 'Montserrat', 'Segoe UI', system-ui, sans-serif;
        }
        .dash-main {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 24px 48px;
        }
        .dash-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .dash-title {
          font-size: 20px;
          font-weight: 800;
          color: #111;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 0;
        }
        .dash-new-btn {
          padding: 10px 22px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 1px;
          text-transform: uppercase;
          background: #D21515;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-family: 'Montserrat', system-ui, sans-serif;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background 0.18s, transform 0.12s;
          box-shadow: 0 2px 12px rgba(210,21,21,0.25);
        }
        .dash-new-btn:hover {
          background: #a81010;
          transform: translateY(-1px);
        }
        .dash-new-btn:active { transform: translateY(0); }

        .dash-placeholder {
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 48px 24px;
          text-align: center;
        }
        .dash-placeholder p {
          color: #888;
          font-size: 14px;
          margin: 0;
        }
      `}</style>

      <div className="dash-page">
        <Navbar user={user} />

        <div className="dash-main">
          <div className="dash-header">
            <h1 className="dash-title">Dashboard</h1>
            <button className="dash-new-btn" onClick={() => navigate('/report/new')}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New Report
            </button>
          </div>

          <div className="dash-placeholder">
            <p>Expense reports will appear here. Create your first report to get started.</p>
          </div>
        </div>
      </div>
    </>
  )
}
