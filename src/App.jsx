import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewReport from './pages/NewReport'
import ReportDetail from './pages/ReportDetail'

// ─── Protected Route wrapper ──────────────────────────────────────────────────
function ProtectedRoute({ session, children }) {
  if (session === undefined) {
    // Still loading — show nothing (or a spinner)
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#888',
        fontSize: '14px',
      }}>
        Loading…
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace />
  }
  return children
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // undefined = still loading, null = no session, object = authenticated
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    // Fetch current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null)
    })

    // Keep session in sync on login / logout / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Protected */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute session={session}>
              <Dashboard user={session?.user} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/report/new"
          element={
            <ProtectedRoute session={session}>
              <NewReport user={session?.user} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/report/:id"
          element={
            <ProtectedRoute session={session}>
              <ReportDetail user={session?.user} />
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
