const CONTACTS = [
  { label: 'HR support', detail: 'hr@exitai.perficient.com · Mon–Fri, 9am–6pm' },
  { label: 'IT helpdesk', detail: 'it-helpdesk@exitai.perficient.com · 24×5' },
  { label: 'Payroll & finance', detail: 'finance@exitai.perficient.com' },
]

export default function HelpPage({ role }) {
  return (
    <div className="card card--pad">
      <p className="card-title">Help and support</p>
      <p className="c-muted" style={{ marginBottom: 10 }}>
        Reach the right team for anything not covered by the ExitAI assistant, {role.toLowerCase()}.
      </p>
      <div className="list list--col">
        {CONTACTS.map((c) => (
          <div key={c.label} className="row">
            <span className="grow">{c.label}</span>
            <span className="sub c-secondary">{c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
