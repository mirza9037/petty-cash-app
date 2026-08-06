import Navbar from '../components/Navbar'

export default function NewReport({ user }) {
  return (
    <>
      <Navbar user={user} />
      <main style={{ padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 8px' }}>
          New Expense Report
        </h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Report creation form coming soon.
        </p>
      </main>
    </>
  )
}
