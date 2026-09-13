/**
 * Dev-only role switcher. Phase 3 routes by profiles.role after login and
 * keeps this behind import.meta.env.DEV, so it never ships in the prod bundle.
 */
const ROLES = [
  ['employee', 'Employee'],
  ['hr', 'HR'],
  ['manager', 'Manager'],
  ['it', 'IT'],
]

export default function RoleSwitcher({ role, onChange }) {
  return (
    <div className="role-switcher">
      {ROLES.map(([key, label]) => (
        <button
          key={key}
          className={role === key ? 'is-on' : undefined}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
