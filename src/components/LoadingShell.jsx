export default function LoadingShell({ role = 'workspace' }) {
  return (
    <div className={`shell shell--${role}`} aria-busy="true" aria-label={`Loading ${role} workspace`}>
      <aside className="sidebar skeleton-sidebar" aria-hidden="true">
        <span className="skeleton skeleton--brand" />
        <div className="skeleton-nav">
          {Array.from({ length: 6 }, (_, index) => <span className="skeleton skeleton--nav" key={index} />)}
        </div>
      </aside>
      <main className="workspace-loading" aria-hidden="true">
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--copy" />
        <div className="skeleton-grid">
          {Array.from({ length: 4 }, (_, index) => <span className="skeleton skeleton--card" key={index} />)}
        </div>
        <span className="skeleton skeleton--panel" />
      </main>
    </div>
  )
}
