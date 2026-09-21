// ── What this file does ──────────────────────────────────────────────────
// The shared left-hand navigation sidebar used by all four role dashboards.
// Each dashboard passes its own nav items (links + icons) and the current
// user's name/initials via props — the layout and sign-out logic are shared.
// ─────────────────────────────────────────────────────────────────────────
/**
 * Sidebar — identical in all four mockups apart from the nav labels and the
 * footer identity, so it takes both as props. `items` are {label, to, end?}
 * — NavLink highlights the active one by matched route, not by array index.
 */
import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import perficientLogo from '../assets/perficient-logo.png'

export default function Sidebar({ items, initials, name, role }) {
  return (
    <div className="card sidebar">
      {/* Brand logo at the top of the sidebar */}
      <div className="brand">
        <img src={perficientLogo} alt="Perficient" className="brand-logo" />
        <span className="brand-name">ExitAI</span>
      </div>

      {/* Nav links — NavLink automatically adds the "is-active" class when
          the current URL matches the link's `to` path. `end` means only
          match exactly that path, not any child routes. */}
      <div className="nav">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          >
            {item.icon && <i className={`ti ${item.icon}`} aria-hidden="true" />}
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Footer: shows who is logged in, and a sign-out button. */}
      <div className="user">
        <span className="avatar">{initials}</span>
        <div className="user-meta">
          <p className="name">{name}</p>
          <p className="role">{role}</p>
        </div>
        {/* supabase.auth.signOut() clears the session cookie; App.jsx's
            onAuthStateChange fires and re-renders the login screen. */}
        <button
          className="logout-btn"
          onClick={() => supabase.auth.signOut()}
          aria-label="Log out"
          title="Log out"
        >
          <i className="ti ti-logout" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
