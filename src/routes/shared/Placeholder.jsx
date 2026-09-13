export default function Placeholder({ title, body }) {
  return (
    <div className="card card--pad">
      <p className="card-title">{title}</p>
      <p className="c-muted">{body}</p>
    </div>
  )
}
