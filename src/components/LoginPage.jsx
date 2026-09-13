import { useState } from 'react'
import { supabase } from '../lib/supabase'
import perficientLogo from '../assets/perficient-logo.png'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
  }

  return (
    <div className="login-shell">
      <div className="login-brand-panel">
        <div className="login-brand-mark">
          <img src={perficientLogo} alt="Perficient" className="login-brand-logo" />
          <span className="login-brand-co">Perficient</span>
        </div>
        <div className="login-brand-copy">
          <h1>ExitAI</h1>
          <p>AI-assisted employee offboarding, from first notice to final clearance.</p>
        </div>
      </div>

      <div className="login-form-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand mb">
            <img src={perficientLogo} alt="Perficient" className="brand-logo" />
            <span className="brand-name">ExitAI</span>
          </div>

          <label className="login-label" htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />

          <label className="login-label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          {error && <p className="login-error">{error}</p>}

          <button type="submit" disabled={busy} className="login-submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="login-divider"><span>or</span></div>

          <button type="button" className="login-ms-btn">
            <svg className="ms-logo" viewBox="0 0 21 21" aria-hidden="true">
              <rect x="1" y="1" width="9" height="9" fill="#F25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
              <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
            </svg>
            Sign in with Microsoft
          </button>
        </form>
      </div>
    </div>
  )
}
