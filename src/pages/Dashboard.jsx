import Navbar from '../components/Navbar'

export default function Dashboard({ user }) {
  return (
    <>
      <Navbar user={user} />
      <main style={{ padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 8px' }}>
          Dashboard
        </h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Expense reports will appear here. Implementation coming soon.
        </p>
      </main>
    </>
  )
}
