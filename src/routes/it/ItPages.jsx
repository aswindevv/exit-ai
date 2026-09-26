import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { withEmployeeHeaders, tieredByCompletion, caseTaskSummary, completionChip } from '../../components/EmployeeGroup'
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

// Fixed grid-column widths for every "queue" table below -- a grid track's
// width is set once on the container, so an Approve button present on one
// row and absent ("—") on the next can't shrink that row's other columns
// the way flex basis/shrink could.
const QUEUE_COLS = 'minmax(300px, 1.6fr) 86px 112px 96px'

const itGroupKey = (t) => t.case_id
// allTasks is the full (unfiltered) IT task list -- "all done" must reflect
// the employee's complete IT task set, not whatever filtered view (pending,
// done, ...) is being rendered.
const itGroupHeader = (allTasks) => (t) => ({ name: t.employee_name, subtitle: t.department, chip: completionChip(t.case_id, allTasks) })
const itAllDone = (allTasks) => (t) => caseTaskSummary(t.case_id, allTasks).allDone
const itCreatedAt = (t) => new Date(t.created_at)

function rowStatus(t) {
  // it_task_view.verification_status is the latest agent_runs outcome for
  // this task's execute/verify/audit run (#18) -- a false "Done" (executed
  // but failed verification) must render distinctly from a real one.
  if (t.verification_status === 'verification_failed') return { label: 'Failed', tone: 't-danger' }
  if (t.status === 'done') return { label: 'Done', tone: 't-success' }
  if (t.due_date && daysUntil(t.due_date) < 0) return { label: 'Overdue', tone: 't-danger' }
  return { label: 'Pending', tone: 't-warning' }
}

function useApprove(reload) {
  const [actioning, setActioning] = useState({})
  async function approveTask(taskId, caseId) {
    setActioning((a) => ({ ...a, [taskId]: 'pending' }))
    const { error } = await supabase.from('exit_tasks').update({ status: 'done' }).eq('id', taskId)
    if (error) {
      setActioning((a) => ({ ...a, [taskId]: error.message }))
      return
    }
    // Trigger real execute/verify/audit (agent #18): agents/service.py is a
    // local-only bridge (see EmployeePages.jsx's /validate-document call).
    // Non-fatal if it's not running -- the approval itself already stuck.
    try {
      await fetch('http://localhost:8787/execute-deprovisioning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId }),
      })
    } catch {
      // agent service unreachable — non-fatal, see comment above
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
    <div className="row" key={t.id} style={{ display: 'grid', gridTemplateColumns: QUEUE_COLS, alignItems: 'center' }}>
      <span className="c-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <i className={`ti ${ASSET_RE.test(t.title) ? ASSET_ICON(t.title) : 'ti-key'} c-muted`} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
      </span>
      <span className="c-secondary">{fmtDate(t.due_date)}</span>
      <span style={{ minWidth: 0 }}>
        <span className={`tag ${s.tone}`} style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{s.label}</span>
      </span>
      <span style={{ textAlign: 'right' }}>
        {t.status === 'done' ? (
          <span className="status c-muted">—</span>
        ) : (
          <>
            <button
              style={{ fontSize: 11, padding: '4px 9px' }}
              onClick={() => approveTask(t.id, t.case_id)}
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
  const [queueFilter, setQueueFilter] = useState('pending')
  const firstName = profile?.full_name?.split(' ')[0] ?? ''

  const pending = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done')
  const overdue = pending.filter((t) => t.due_date && daysUntil(t.due_date) < 0)
  const failed = tasks.filter((t) => t.verification_status === 'verification_failed')
  const queueRows = tasks.filter((t) => {
    if (queueFilter === 'pending') return t.status !== 'done'
    if (queueFilter === 'overdue') return t.status !== 'done' && t.due_date && daysUntil(t.due_date) < 0
    if (queueFilter === 'failed') return t.verification_status === 'verification_failed'
    if (queueFilter === 'done') return t.status === 'done' && t.verification_status !== 'verification_failed'
    return true
  })

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
    <div className="it-dashboard">
      <h2 className="sr-only">
        IT dashboard with a sidebar nav, deprovisioning queue awaiting approval, asset recovery list, and access revocation summary.
      </h2>

      <PageHead
        name={firstName}
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

      <section className="card card--pad mb it-queue">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Controlled execution</p>
            <h2>Deprovisioning work queue</h2>
            <p>Review by employee, then approve each task for execution and verification.</p>
          </div>
          <span className="tag t-warning">{pending.length} require action</span>
        </div>
        <div className="queue-filters" role="group" aria-label="Filter deprovisioning queue">
          {[
            ['pending', 'Pending', pending.length],
            ['overdue', 'Overdue', overdue.length],
            ['failed', 'Failed verification', failed.length],
            ['done', 'Verified', done.length - failed.length],
            ['all', 'All', tasks.length],
          ].map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={`queue-filter${queueFilter === key ? ' is-active' : ''}`}
              aria-pressed={queueFilter === key}
              onClick={() => setQueueFilter(key)}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="list">
          <div className="thead" style={{ display: 'grid', gridTemplateColumns: QUEUE_COLS }}>
            <span>Task</span>
            <span>Due</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>
          {withEmployeeHeaders(
            tieredByCompletion([...queueRows], itAllDone(tasks), itCreatedAt),
            itGroupKey,
            itGroupHeader(tasks),
            (t) => <TaskRow key={t.id} t={t} actioning={actioning} approveTask={approveTask} />
          )}
          {queueRows.length === 0 && <div className="empty-state"><i className="ti ti-circle-check" aria-hidden="true" /><p>No tasks in this view.</p><span>Choose another status to inspect the queue.</span></div>}
        </div>
      </section>

      <div className="two-col two-col--even mb">
        <div className="card card--pad">
          <p className="card-title">Asset recovery</p>
          <div className="list">
            {withEmployeeHeaders(
              tieredByCompletion([...assetTasks], itAllDone(tasks), itCreatedAt),
              itGroupKey,
              itGroupHeader(tasks),
              (t) => {
                const s = rowStatus(t)
                return (
                  <div className="row" key={t.id}>
                    <i className={`ti ${ASSET_ICON(t.title)} c-muted`} aria-hidden="true" />
                    <span className="grow">{t.title}</span>
                    <span className={`tag ${s.tone}`}>{s.label === 'Done' ? 'Collected' : s.label}</span>
                  </div>
                )
              }
            )}
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
    </div>
  )
}

export function Deprovisioning() {
  const { tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  return (
    <div className="card card--pad">
      <p className="card-title">Deprovisioning queue</p>
      <div className="list">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: QUEUE_COLS }}>
          <span>Task</span>
          <span>Due</span>
          <span>Status</span>
          <span style={{ textAlign: 'right' }}>Action</span>
        </div>
        {withEmployeeHeaders(
          tieredByCompletion([...tasks], itAllDone(tasks), itCreatedAt),
          itGroupKey,
          itGroupHeader(tasks),
          (t) => <TaskRow key={t.id} t={t} actioning={actioning} approveTask={approveTask} />
        )}
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
        {withEmployeeHeaders(
          tieredByCompletion([...assetTasks], itAllDone(tasks), itCreatedAt),
          itGroupKey,
          itGroupHeader(tasks),
          (t) => {
            const s = rowStatus(t)
            return (
              <div className="row" key={t.id}>
                <i className={`ti ${ASSET_ICON(t.title)} c-muted`} aria-hidden="true" />
                <span className="grow">{t.title}</span>
                <span className={`tag ${s.tone}`}>{s.label === 'Done' ? 'Collected' : s.label}</span>
              </div>
            )
          }
        )}
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
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: QUEUE_COLS }}>
          <span>Task</span>
          <span>Due</span>
          <span>Status</span>
          <span style={{ textAlign: 'right' }}>Action</span>
        </div>
        {withEmployeeHeaders(
          tieredByCompletion([...pending], itAllDone(tasks), itCreatedAt),
          itGroupKey,
          itGroupHeader(tasks),
          (t) => <TaskRow key={t.id} t={t} actioning={actioning} approveTask={approveTask} />
        )}
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
          <span style={{ flex: 1.6 }}>Task</span>
          <span style={{ width: 70, textAlign: 'right' }}>Completed</span>
        </div>
        {withEmployeeHeaders(
          tieredByCompletion([...done], itAllDone(tasks), itCreatedAt),
          itGroupKey,
          itGroupHeader(tasks),
          (t) => (
            <div className="row" key={t.id}>
              <span className="c-secondary" style={{ flex: 1.6 }}>{t.title}</span>
              <span className="c-secondary" style={{ width: 70, textAlign: 'right' }}>{fmtDate(t.due_date)}</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}
