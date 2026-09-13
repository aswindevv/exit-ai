import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { supabase } from '../../lib/supabase'
import { fmtDate, daysUntil } from '../../lib/format'

const CHIPS = [
  { tone: 't-plain', k: 'Queue', v: 'IT stage' },
  { tone: 't-warning', text: 'Nothing runs until approved' },
]

// ponytail: no assets/access-category tables exist yet — categorize by
// keyword match on the task title. Upgrade to a real category column when
// the IT agent (Phase 6b) starts writing structured deprovisioning plans.
const ASSET_RE = /laptop|macbook|device|headset|card|asset|collect/i
const ASSET_ICON = (title) =>
  /laptop|macbook/i.test(title) ? 'ti-device-laptop' : /card/i.test(title) ? 'ti-id' : /headset/i.test(title) ? 'ti-headphones' : 'ti-box'
const ACCESS_CATEGORIES = [
  { label: 'Identity and SSO', re: /sso|identity|account/i },
  { label: 'Source control', re: /repo|repository|source|git/i },
  { label: 'SaaS applications', re: /.*/ },
]

function rowStatus(t) {
  if (t.status === 'done') return { label: 'Done', tone: 't-success' }
  if (t.due_date && daysUntil(t.due_date) < 0) return { label: 'Overdue', tone: 't-danger' }
  return { label: 'Pending', tone: 't-warning' }
}

function useApprove(reload) {
  const [actioning, setActioning] = useState({})
  async function approveTask(taskId) {
    setActioning((a) => ({ ...a, [taskId]: 'pending' }))
    const { error } = await supabase.from('exit_tasks').update({ status: 'done' }).eq('id', taskId)
    if (error) {
      setActioning((a) => ({ ...a, [taskId]: error.message }))
      return
    }
    await reload()
    setActioning((a) => {
      const next = { ...a }
      delete next[taskId]
      return next
    })
  }
  return [actioning, approveTask]
}

function TaskRow({ t, actioning, approveTask }) {
  const s = rowStatus(t)
  return (
    <div className="row" key={t.id}>
      <span style={{ flex: 1.2 }}>{t.employee_name}</span>
      <span className="c-secondary" style={{ flex: 1.6 }}>{t.title}</span>
      <span className="c-secondary" style={{ width: 52 }}>{fmtDate(t.due_date)}</span>
      <span style={{ width: 64 }}>
        <span className={`tag ${s.tone}`}>{s.label}</span>
      </span>
      <span style={{ width: 62, textAlign: 'right' }}>
        {t.status === 'done' ? (
          <span className="status c-muted">—</span>
        ) : (
          <>
            <button
              style={{ fontSize: 11, padding: '4px 9px' }}
              onClick={() => approveTask(t.id)}
              disabled={actioning[t.id] === 'pending'}
            >
              {actioning[t.id] === 'pending' ? 'Approving…' : 'Approve'}
            </button>
            {actioning[t.id] && actioning[t.id] !== 'pending' && (
              <p className="sub c-danger" style={{ marginTop: 2, textAlign: 'right' }}>
                {actioning[t.id]}
              </p>
            )}
          </>
        )}
      </span>
    </div>
  )
}

export function Dashboard() {
  const { profile, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const firstName = profile?.full_name?.split(' ')[0] ?? ''

  const pending = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')
  const overdue = pending.filter((t) => t.due_date && daysUntil(t.due_date) < 0)

  const KPIS = [
    { label: 'Pending approval', value: String(pending.length), tone: 'var(--text-warning)' },
    { label: 'Completed', value: String(done.length), tone: 'var(--text-success)' },
    { label: 'Overdue', value: String(overdue.length), tone: 'var(--text-danger)' },
    { label: 'Total items', value: String(tasks.length), tone: 'var(--text-primary)' },
  ]

  const assetTasks = tasks.filter((t) => ASSET_RE.test(t.title))
  const accessTasks = tasks.filter((t) => !ASSET_RE.test(t.title))
  const REVOCATION = ACCESS_CATEGORIES.map((cat) => {
    const bucket = accessTasks.filter((t) => cat.re.test(t.title))
    const doneCount = bucket.filter((t) => t.status === 'done').length
    return {
      label: cat.label,
      count: `${doneCount} of ${bucket.length}`,
      width: bucket.length ? `${Math.round((doneCount / bucket.length) * 100)}%` : '0%',
      fill: doneCount === bucket.length && bucket.length ? 'bar-fill bar-fill--success' : 'bar-fill',
    }
  }).filter((r) => r.count !== '0 of 0')

  return (
    <>
      <h2 className="sr-only">
        IT dashboard with a sidebar nav, deprovisioning queue awaiting approval, asset recovery list, and access revocation summary.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle={`${pending.length} deprovisioning item${pending.length === 1 ? '' : 's'} are waiting for your approval.`}
        chips={CHIPS}
      />

      <div className="kpi-row mb">
        {KPIS.map((k) => (
          <span key={k.label} className="kpi">
            {k.label} <b style={{ color: k.tone }}>{k.value}</b>
          </span>
        ))}
      </div>

      <div className="card card--pad mb">
        <p className="card-title">Deprovisioning queue</p>
        <div className="list">
          <div className="thead">
            <span style={{ flex: 1.2 }}>Employee</span>
            <span style={{ flex: 1.6 }}>Task</span>
            <span style={{ width: 52 }}>Due</span>
            <span style={{ width: 64 }}>Status</span>
            <span style={{ width: 62, textAlign: 'right' }}>Action</span>
          </div>
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} actioning={actioning} approveTask={approveTask} />
          ))}
        </div>
      </div>

      <div className="two-col two-col--even mb">
        <div className="card card--pad">
          <p className="card-title">Asset recovery</p>
          <div className="list">
            {assetTasks.map((t) => {
              const s = rowStatus(t)
              return (
                <div className="row" key={t.id}>
                  <i className={`ti ${ASSET_ICON(t.title)} c-muted`} aria-hidden="true" />
                  <span className="grow">{t.title} · {t.employee_name}</span>
                  <span className={`status ${s.tone === 't-danger' ? 'c-danger' : s.tone === 't-success' ? 'c-success' : 'c-warning'}`}>
                    {s.label === 'Done' ? 'Collected' : s.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card card--pad">
          <p className="card-title">Access revocation</p>
          <div className="bars">
            {REVOCATION.map((b) => (
              <div key={b.label}>
                <div className="bar-head">
                  <span>{b.label}</span>
                  <span className="c-muted">{b.count}</span>
                </div>
                <div className="bar-track">
                  <div className={b.fill} style={{ width: b.width }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="strip strip--top">
        <span className="strip-icon">
          <i className="ti ti-shield-lock" aria-hidden="true" />
        </span>
        <div className="grow">
          <p className="strip-title">Deprovisioning plan (agent)</p>
          <p className="strip-body">
            {tasks.length} item{tasks.length === 1 ? '' : 's'} generated for this queue. Every item stays pending
            until you approve it — nothing is executed automatically.
          </p>
        </div>
      </div>
    </>
  )
}

export function Deprovisioning() {
  const { tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  return (
    <div className="card card--pad">
      <p className="card-title">Deprovisioning queue</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.2 }}>Employee</span>
          <span style={{ flex: 1.6 }}>Task</span>
          <span style={{ width: 52 }}>Due</span>
          <span style={{ width: 64 }}>Status</span>
          <span style={{ width: 62, textAlign: 'right' }}>Action</span>
        </div>
        {tasks.map((t) => (
          <TaskRow key={t.id} t={t} actioning={actioning} approveTask={approveTask} />
        ))}
      </div>
    </div>
  )
}

export function AssetRecovery() {
  const { tasks } = useOutletContext()
  const assetTasks = tasks.filter((t) => ASSET_RE.test(t.title))
  return (
    <div className="card card--pad">
      <p className="card-title">Asset recovery</p>
      <div className="list">
        {assetTasks.map((t) => {
          const s = rowStatus(t)
          return (
            <div className="row" key={t.id}>
              <i className={`ti ${ASSET_ICON(t.title)} c-muted`} aria-hidden="true" />
              <span className="grow">{t.title} · {t.employee_name}</span>
              <span className={`status ${s.tone === 't-danger' ? 'c-danger' : s.tone === 't-success' ? 'c-success' : 'c-warning'}`}>
                {s.label === 'Done' ? 'Collected' : s.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AccessReviews() {
  const { tasks } = useOutletContext()
  const accessTasks = tasks.filter((t) => !ASSET_RE.test(t.title))
  const REVOCATION = ACCESS_CATEGORIES.map((cat) => {
    const bucket = accessTasks.filter((t) => cat.re.test(t.title))
    const doneCount = bucket.filter((t) => t.status === 'done').length
    return {
      label: cat.label,
      count: `${doneCount} of ${bucket.length}`,
      width: bucket.length ? `${Math.round((doneCount / bucket.length) * 100)}%` : '0%',
      fill: doneCount === bucket.length && bucket.length ? 'bar-fill bar-fill--success' : 'bar-fill',
    }
  }).filter((r) => r.count !== '0 of 0')

  return (
    <div className="card card--pad">
      <p className="card-title">Access revocation</p>
      <div className="bars">
        {REVOCATION.map((b) => (
          <div key={b.label}>
            <div className="bar-head">
              <span>{b.label}</span>
              <span className="c-muted">{b.count}</span>
            </div>
            <div className="bar-track">
              <div className={b.fill} style={{ width: b.width }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Approvals() {
  const { tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const pending = tasks.filter((t) => t.status !== 'done')
  return (
    <div className="card card--pad">
      <p className="card-title">Approvals</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.2 }}>Employee</span>
          <span style={{ flex: 1.6 }}>Task</span>
          <span style={{ width: 52 }}>Due</span>
          <span style={{ width: 64 }}>Status</span>
          <span style={{ width: 62, textAlign: 'right' }}>Action</span>
        </div>
        {pending.map((t) => (
          <TaskRow key={t.id} t={t} actioning={actioning} approveTask={approveTask} />
        ))}
      </div>
    </div>
  )
}

export function AuditLog() {
  const { tasks } = useOutletContext()
  const done = tasks.filter((t) => t.status === 'done')
  return (
    <div className="card card--pad">
      <p className="card-title">Audit log</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.2 }}>Employee</span>
          <span style={{ flex: 1.6 }}>Task</span>
          <span style={{ width: 70, textAlign: 'right' }}>Completed</span>
        </div>
        {done.map((t) => (
          <div className="row" key={t.id}>
            <span style={{ flex: 1.2 }}>{t.employee_name}</span>
            <span className="c-secondary" style={{ flex: 1.6 }}>{t.title}</span>
            <span className="c-secondary" style={{ width: 70, textAlign: 'right' }}>{fmtDate(t.due_date)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
