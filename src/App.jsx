// ─── What this file does ─────────────────────────────────────────────────────
// Root of the React application. Checks whether the user is logged in (via
// Supabase Auth), looks up their role (employee/hr/manager/it), and then renders
// the correct dashboard. If not logged in, shows the LoginPage instead.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { supabase } from './lib/supabase'
import LoginPage from './components/LoginPage.jsx'
import RoleSwitcher from './components/RoleSwitcher.jsx'
import AppRoutes from './routes/AppRoutes.jsx'

// Dev-only convenience, never a security boundary — RLS is what actually
// stops cross-role reads. Off by default; requires both the dev build AND
// an explicit opt-in env var, so it never ships and never turns on by accident.
const ROLE_SWITCHER_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_ROLE_SWITCHER === 'true'

export default function App() {
  // useState stores values that can change over time. When they change, React
  // re-renders the component automatically.
  // undefined = "still checking auth"; null = "checked, not logged in".
  const [session, setSession] = useState(undefined) // undefined = loading
  const [role, setRole] = useState(null)             // "employee" | "hr" | "manager" | "it" | null
  const [devRole, setDevRole] = useState(null)       // dev-only override role

  // useEffect runs code after the component renders. The empty [] means it runs
  // only once (on first render), not on every update.
  useEffect(() => {
    // Get the current session (e.g. from a saved cookie/token after a page refresh).
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    // Subscribe to future auth changes (login, logout) and keep session in sync.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    // Cleanup: unsubscribe when the component is removed from the page.
    return () => sub.subscription.unsubscribe()
  }, [])

  // Whenever session changes, look up the user's role in the profiles table.
  // [session] means: re-run this effect every time the `session` value changes.
  useEffect(() => {
    if (!session) {
      setRole(null)
      return
    }
    supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)   // match the logged-in user's auth ID
      .single()
      .then(({ data }) => setRole(data?.role ?? null))
  }, [session])

  // Show nothing while auth is loading (avoids a flash of the wrong screen).
  if (session === undefined || (session && role === null)) return null
  if (!session) return <LoginPage />

  const activeRole = ROLE_SWITCHER_ENABLED && devRole ? devRole : role

  return (
    <>
      {ROLE_SWITCHER_ENABLED && <RoleSwitcher role={devRole ?? role} onChange={setDevRole} />}
      <div className="frame">
        <BrowserRouter>
          <AppRoutes role={activeRole} session={session} />
        </BrowserRouter>
      </div>
    </>
  )
}
