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
  const [session, setSession] = useState(undefined) // undefined = loading
  const [role, setRole] = useState(null)
  const [devRole, setDevRole] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setRole(null)
      return
    }
    supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setRole(data?.role ?? null))
  }, [session])

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
