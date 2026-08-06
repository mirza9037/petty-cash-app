import { useParams } from 'react-router-dom'
import Navbar from '../components/Navbar'

export default function ReportDetail({ user }) {
  const { id } = useParams()

  return (
    <>
      <Navbar user={user} />
      <main style={{ padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 8px' }}>
          Report Detail
        </h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Report ID: <code>{id}</code> — full detail view coming soon.
        </p>
      </main>
    </>
  )
}
