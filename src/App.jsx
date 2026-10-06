import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase, configurationError } from './lib/supabase'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const NewReport = lazy(() => import('./pages/NewReport'))
const ReportDetail = lazy(() => import('./pages/ReportDetail'))
const ExcelTransfer = lazy(() => import('./pages/ExcelTransfer'))
function Access({ session, children }) {
  if (session === undefined) return <p className="app-message">Loading…</p>
  if (!session) return <Navigate to="/login" replace />
  return children
}
export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth
      .getSession()
      .then(({ data, error: failure }) => {
        if (!active) return
        if (failure) setError('Unable to restore your session. Please retry.')
        else setSession(data.session)
      })
      .catch(() => {
        if (active) setError('Unable to restore your session. Please retry.')
      })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [retry])
  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) return
    let active = true
    supabase
      .from('profiles')
      .select('id,role,display_name,active')
      .eq('id', userId)
      .single()
      .retry(false)
      .then(({ data, error: failure }) => {
        if (!active) return
        if (failure || !data?.active)
          setError(
            'Staff access is unavailable. Ask your administrator to check your profile and database setup.',
          )
        else setProfile(data)
      })
      .catch(() => {
        if (active) setError('Unable to load staff permissions. Please retry.')
      })
    return () => {
      active = false
    }
  }, [userId, retry])
  if (configurationError || error)
    return (
      <main className="app-message" role="alert">
        <h1>Unable to open the app</h1>
        <p>{configurationError || error}</p>
        {!configurationError && (
          <>
            <button
              onClick={() => {
                setError('')
                setProfile(null)
                setRetry((v) => v + 1)
              }}
            >
              Retry
            </button>
            <button
              onClick={async () => {
                try {
                  const result = await supabase.auth.signOut()
                  if (result.error) throw result.error
                  setError('')
                  setProfile(null)
                } catch {
                  setError('Sign out failed. Check your connection and try again.')
                }
              }}
            >
              Sign out
            </button>
          </>
        )}
      </main>
    )
  const ready = !session || profile?.id === session.user.id
  const user = session
    ? { ...session.user, staffRole: profile?.role, displayName: profile?.display_name }
    : null
  const protect = (page) => <Access session={ready ? session : undefined}>{page}</Access>
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<p className="app-message">Loading…</p>}>
          <Routes>
            <Route
              path="/login"
              element={session ? <Navigate to="/dashboard" replace /> : <Login />}
            />
            <Route path="/dashboard" element={protect(<Dashboard key={user?.id} user={user} />)} />
            <Route path="/excel" element={protect(<ExcelTransfer key={user?.id} user={user} />)} />
            <Route
              path="/report/new"
              element={protect(<NewReport key={'new-' + user?.id} user={user} />)}
            />
            <Route path="/report/:id/edit" element={protect(<NewReport user={user} />)} />
            <Route path="/report/:id" element={protect(<ReportDetail user={user} />)} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
