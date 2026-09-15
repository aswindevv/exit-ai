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
      <div className="brand">
        <img src={perficientLogo} alt="Perficient" className="brand-logo" />
        <span className="brand-name">ExitAI</span>
      </div>

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

      <div className="user">
        <span className="avatar">{initials}</span>
        <div className="user-meta">
          <p className="name">{name}</p>
          <p className="role">{role}</p>
        </div>
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
