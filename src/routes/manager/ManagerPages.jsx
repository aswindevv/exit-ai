import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { withEmployeeHeaders, tieredByCompletion, caseTaskSummary, completionChip, CASE_GATE_STAGES } from '../../components/EmployeeGroup'
import { taskClearanceStatus, CLEARANCE_TAG } from '../../lib/clearanceStatus'
import { supabase } from '../../lib/supabase'
import { fmtDate, daysUntil } from '../../lib/format'

const BTN = { fontSize: 11, padding: '4px 9px' }

function dayTone(dateStr) {
  const d = daysUntil(dateStr)
  if (d <= 3) return 't-danger'
  if (d <= 10) return 't-accent'
  return 't-neutral'
}

// Fixed grid-column widths for the flat employee tables below -- a grid
// track's width is set once on the container, so it can't drift row to row
// the way flex basis/shrink could when one row's content differs.
const TEAM_COLS = '1.4fr 1.2fr 1fr 70px'
const REPORTS_COLS = '1.4fr 1fr 70px 90px'
const TIMELINE_COLS = '1.4fr 1fr 70px'
const CLEARANCE_COLS = '1.6fr 80px 74px 62px'

const CELL_ELLIPSIS = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const mgrGroupKey = (t) => t.case_id
// allTasks is the manager's full accessible task set for the case (every
// stage) -- "all done" must reflect the whole case, not just this list.
const mgrGroupHeader = (reportsById, allTasks) => (t) => {
  const r = reportsById[t.case_id]
  return {
    name: r?.employee_name,
    subtitle: r ? `${r.department} · Last day ${fmtDate(r.last_working_day)}` : undefined,
    chip: completionChip(t.case_id, allTasks, CASE_GATE_STAGES),
  }
}
// KT approvals tier only on KT (manager-stage) completion, not the whole
// case -- a case with its KT done but IT/finance still pending must still
// sink to the bottom of the KT list once KT itself needs no more manager
// action. ktTasks is already the complete manager-stage set (unfiltered by
// visibility), so this sees every row, not just what's rendered.
const mgrKtAllDone = (ktTasks) => (t) => caseTaskSummary(t.case_id, ktTasks, ['manager']).allDone
const mgrCreatedAt = (reportsById) => (t) => new Date(reportsById[t.case_id]?.created_at ?? 0)

// KT approval (manager "Review") and clearance sign-off (manager "Sign") are
// both just approving a task -- mark it done. RLS (0008) only lets a manager
// do this for their own reports' manager/finance-stage tasks, and only to
// 'done', so this can't be used to un-approve or touch other rows.
function useApprove(reload) {
  const [actioning, setActioning] = useState({})
  async function approveTask(task) {
    const taskId = task.id
    setActioning((a) => ({ ...a, [taskId]: 'pending' }))
    const { error } = await supabase.from('exit_tasks').update({ status: 'done' }).eq('id', taskId)
    if (error) {
      setActioning((a) => ({ ...a, [taskId]: error.message }))
      return
    }
    // Approving KT is the manager gate's approved branch, and on the browser
    // path nothing else takes it: /manager-approve advances the case to IT
    // (agents/service.py), exactly as supervisor.py's manager_gate --approved-->
    // it edge does. The service re-checks in the database that every KT task is
    // done before it advances, so this is a trigger, not the decision. Every
    // approve site here is manager-stage today ('Review' and 'Sign' both act on
    // stage='manager' rows); the guard keeps it that way if a finance-stage row
    // is ever routed through this hook, which 0008 would also permit.
    // Non-fatal if the service isn't running: the approval above already stuck,
    // same posture as ItPages.jsx's /execute-deprovisioning call.
    if (task.stage === 'manager') {
      try {
        await fetch('http://localhost:8787/manager-approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ case_id: task.case_id }),
        })
      } catch {
        // agent service unreachable — non-fatal, see comment above
      }
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

// Reject has no RLS path of its own (exit_tasks has no INSERT policy and
// 0008's UPDATE policies pin status to 'done') -- it goes through the local
// agent service, which mirrors agents.supervisor._escalate's insert. Unlike
// useApprove's fetch calls elsewhere in this app, this one is NOT non-fatal:
// there is no other write, so a service failure must surface as a failure.
function useReject(reload) {
  const [rejecting, setRejecting] = useState({})
  async function rejectTask(taskId, caseId) {
    const reason = window.prompt('Reason for rejecting this KT plan (required):')?.trim()
    if (!reason) return
    setRejecting((r) => ({ ...r, [taskId]: 'pending' }))
    try {
      const res = await fetch('http://localhost:8787/reject-manager-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, task_id: taskId, reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        setRejecting((r) => ({ ...r, [taskId]: data.error || `Reject failed (HTTP ${res.status})` }))
        return
      }
    } catch (err) {
      setRejecting((r) => ({ ...r, [taskId]: `Agent service unreachable -- ${err.message}` }))
      return
    }
    await reload()
    setRejecting((r) => {
      const next = { ...r }
      delete next[taskId]
      return next
    })
  }
  return [rejecting, rejectTask]
}

const isEscalated = (t) => Boolean(t.title?.startsWith('Escalated'))
// A reroute reopens the manager gate: the KT task's own row never changes,
// so suppressing its Review/Reject buttons needs to look at the case's
// escalation row, not just the row's own escalation_state.
const hasOpenEscalation = (caseId, tasks) => tasks.some((x) => x.case_id === caseId && x.escalation_state === 'open')

export function Dashboard() {
  const { profile, reports, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const [rejecting, rejectTask] = useReject(reload)
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const reportsById = Object.fromEntries(reports.map((r) => [r.id, r]))

  const ktTasks = tasks.filter((t) => t.stage === 'manager')
  const ktToReview = ktTasks.filter((t) => t.status !== 'done').length
  // Manager scope: finance-stage rows belong to Finance, not this dashboard.
  // "To sign" is what the manager can actually action now -- a blocked or
  // escalated row is not signable, so it must not be counted here.
  const toSign = ktTasks.filter((t) => taskClearanceStatus(t, tasks).key === 'ready')

  const CHIPS = [
    { tone: 't-plain', k: 'Reports', v: String(reports.length) },
    ktToReview > 0 && { tone: 't-warning', text: `${ktToReview} awaiting you` },
  ].filter(Boolean)

  const KPIS = [
    { label: 'Exiting reports', value: String(reports.length) },
    { label: 'KT to review', value: String(ktToReview), valueClass: 'c-warning' },
    { label: 'Clearances to sign', value: String(toSign.length), valueClass: 'c-accent' },
  ]

  return (
    <>
      <h2 className="sr-only">
        Manager dashboard with a sidebar nav, team exit summary, exiting reports
        table, knowledge-transfer approvals, and a KT review summary.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle={`${reports.length} of your reports are exiting this month.`}
        chips={CHIPS}
      />

      <div className="kpi-row mb">
        {KPIS.map((k) => (
          <span key={k.label} className="kpi">
            {k.label} <b className={k.valueClass}>{k.value}</b>
          </span>
        ))}
      </div>

      <div className="card card--pad mb">
        <p className="card-title">My team's exits</p>
        <div className="list">
          <div className="thead" style={{ display: 'grid', gridTemplateColumns: TEAM_COLS }}>
            <span>Employee</span>
            <span>Role</span>
            <span>Department</span>
            <span style={{ textAlign: 'right' }}>Last day</span>
          </div>
          {reports.map((e) => (
            <div className="row" key={e.id} style={{ display: 'grid', gridTemplateColumns: TEAM_COLS, alignItems: 'center' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.employee_name}</span>
              <span className="c-secondary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.role_title}</span>
              <span className="c-secondary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.department}</span>
              <span style={{ textAlign: 'right' }}>
                <span className={`tag ${dayTone(e.last_working_day)}`}>{fmtDate(e.last_working_day)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col two-col--even mb">
        <div className="card card--pad">
          <p className="card-title">KT approvals</p>
          <div className="list">
            {withEmployeeHeaders(
              tieredByCompletion([...ktTasks], mgrKtAllDone(ktTasks), mgrCreatedAt(reportsById)),
              mgrGroupKey,
              mgrGroupHeader(reportsById, tasks),
              (t) => (
                <div className="row row--split" key={t.id}>
                  <div>
                    <p className="sub">{t.title}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ''}</p>
                  </div>
                  {isEscalated(t) || hasOpenEscalation(t.case_id, tasks) ? (
                    <span className="tag t-danger">Escalated to HR</span>
                  ) : t.status === 'done' ? (
                    <span className="tag t-success">Approved</span>
                  ) : (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          style={BTN}
                          onClick={() => approveTask(t)}
                          disabled={actioning[t.id] === 'pending' || rejecting[t.id] === 'pending'}
                        >
                          {actioning[t.id] === 'pending' ? 'Approving…' : 'Review'}
                        </button>
                        <button
                          className="c-danger"
                          style={{ ...BTN, borderColor: 'var(--text-danger)' }}
                          onClick={() => rejectTask(t.id, t.case_id)}
                          disabled={actioning[t.id] === 'pending' || rejecting[t.id] === 'pending'}
                        >
                          {rejecting[t.id] === 'pending' ? 'Rejecting…' : 'Reject'}
                        </button>
                      </div>
                      {actioning[t.id] && actioning[t.id] !== 'pending' && (
                        <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[t.id]}</p>
                      )}
                      {rejecting[t.id] && rejecting[t.id] !== 'pending' && (
                        <p className="sub c-danger" style={{ marginTop: 2 }}>{rejecting[t.id]}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        <div className="card card--pad">
          <p className="card-title">Clearances to sign</p>
          <div className="list">
            {withEmployeeHeaders(
              tieredByCompletion([...toSign], mgrKtAllDone(ktTasks), mgrCreatedAt(reportsById)),
              mgrGroupKey,
              mgrGroupHeader(reportsById, tasks),
              (t) => (
                <div className="row row--split" key={t.id}>
                  <div>
                    <p>{t.title}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <button
                      style={BTN}
                      onClick={() => approveTask(t)}
                      disabled={actioning[t.id] === 'pending'}
                    >
                      {actioning[t.id] === 'pending' ? 'Signing…' : 'Sign'}
                    </button>
                    {actioning[t.id] && actioning[t.id] !== 'pending' && (
                      <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[t.id]}</p>
                    )}
                  </div>
                </div>
              )
            )}
            {!toSign.length && <p className="sub">Nothing to sign right now.</p>}
          </div>
        </div>
      </div>

      <div className="strip strip--top">
        <span className="strip-icon">
          <i className="ti ti-file-search" aria-hidden="true" />
        </span>
        <div className="grow">
          <p className="strip-title">KT review summary</p>
          <p className="strip-body">
            {ktToReview} knowledge-transfer item{ktToReview === 1 ? '' : 's'} awaiting your review across{' '}
            {reports.length} exiting report{reports.length === 1 ? '' : 's'}. Gap analysis is generated by the
            HR agent once KT documents are submitted (Phase 6b).
          </p>
        </div>
      </div>
    </>
  )
}

export function MyTeam() {
  const { reports } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">My team's exits</p>
      <div className="list">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: TEAM_COLS }}>
          <span>Employee</span>
          <span>Role</span>
          <span>Department</span>
          <span style={{ textAlign: 'right' }}>Last day</span>
        </div>
        {reports.map((e) => (
          <div className="row" key={e.id} style={{ display: 'grid', gridTemplateColumns: TEAM_COLS, alignItems: 'center' }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.employee_name}</span>
            <span className="c-secondary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.role_title}</span>
            <span className="c-secondary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.department}</span>
            <span style={{ textAlign: 'right' }}>
              <span className={`tag ${dayTone(e.last_working_day)}`}>{fmtDate(e.last_working_day)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExitingReports() {
  const { reports, tasks } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">Exiting reports</p>
      <div className="list">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: REPORTS_COLS }}>
          <span>Employee</span>
          <span>Department</span>
          <span>Last day</span>
          <span style={{ textAlign: 'right' }}>Progress</span>
        </div>
        {reports.map((e) => {
          const caseTasks = tasks.filter((t) => t.case_id === e.id)
          const done = caseTasks.filter((t) => t.status === 'done').length
          return (
            <div className="row" key={e.id} style={{ display: 'grid', gridTemplateColumns: REPORTS_COLS, alignItems: 'center' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.employee_name}</span>
              <span className="c-secondary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.department}</span>
              <span className="c-secondary">{fmtDate(e.last_working_day)}</span>
              <span style={{ textAlign: 'right' }} className="c-secondary">
                {caseTasks.length ? `${done} of ${caseTasks.length}` : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function KtApprovals() {
  const { reports, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const [rejecting, rejectTask] = useReject(reload)
  const reportsById = Object.fromEntries(reports.map((r) => [r.id, r]))
  const ktTasks = tasks.filter((t) => t.stage === 'manager')
  return (
    <div className="card card--pad">
      <p className="card-title">KT approvals</p>
      <div className="list">
        {withEmployeeHeaders(
          tieredByCompletion([...ktTasks], mgrKtAllDone(ktTasks), mgrCreatedAt(reportsById)),
          mgrGroupKey,
          mgrGroupHeader(reportsById, tasks),
          (t) => (
            <div className="row row--split" key={t.id}>
              <div>
                <p>{t.title}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ''}</p>
              </div>
              {isEscalated(t) || hasOpenEscalation(t.case_id, tasks) ? (
                <span className="tag t-danger">Escalated to HR</span>
              ) : t.status === 'done' ? (
                <span className="tag t-success">Approved</span>
              ) : (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button style={BTN} onClick={() => approveTask(t)} disabled={actioning[t.id] === 'pending' || rejecting[t.id] === 'pending'}>
                      {actioning[t.id] === 'pending' ? 'Approving…' : 'Review'}
                    </button>
                    <button
                      className="c-danger"
                      style={{ ...BTN, borderColor: 'var(--text-danger)' }}
                      onClick={() => rejectTask(t.id, t.case_id)}
                      disabled={actioning[t.id] === 'pending' || rejecting[t.id] === 'pending'}
                    >
                      {rejecting[t.id] === 'pending' ? 'Rejecting…' : 'Reject'}
                    </button>
                  </div>
                  {actioning[t.id] && actioning[t.id] !== 'pending' && (
                    <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[t.id]}</p>
                  )}
                  {rejecting[t.id] && rejecting[t.id] !== 'pending' && (
                    <p className="sub c-danger" style={{ marginTop: 2 }}>{rejecting[t.id]}</p>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

export function Clearances() {
  const { reports, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const reportsById = Object.fromEntries(reports.map((r) => [r.id, r]))
  // Manager scope only. Finance-stage rows ("Clear final settlement dues") are
  // Finance's to clear and belong on the Finance queue, not here.
  const managerTasks = tasks.filter((t) => t.stage === 'manager')
  return (
    <div className="card card--pad">
      <p className="card-title">Clearances to sign</p>
      <div className="list">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: CLEARANCE_COLS }}>
          <span>Task</span>
          <span>Due</span>
          <span style={{ textAlign: 'right' }}>Status</span>
          <span style={{ textAlign: 'right' }}>Action</span>
        </div>
        {withEmployeeHeaders(
          tieredByCompletion([...managerTasks], mgrKtAllDone(managerTasks), mgrCreatedAt(reportsById)),
          mgrGroupKey,
          mgrGroupHeader(reportsById, tasks),
          (t) => {
            const state = taskClearanceStatus(t, tasks)
            const tag = CLEARANCE_TAG[state.key]
            return (
              <div key={t.id}>
                <div className="row" style={{ display: 'grid', gridTemplateColumns: CLEARANCE_COLS, alignItems: 'center' }}>
                  <span style={CELL_ELLIPSIS}>{t.title}</span>
                  <span className="c-secondary">{t.due_date ? fmtDate(t.due_date) : '—'}</span>
                  <span style={{ textAlign: 'right' }}>
                    <span className={`tag ${tag.tone}`}>{tag.label}</span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    {state.key === 'ready' ? (
                      <button style={BTN} onClick={() => approveTask(t)} disabled={actioning[t.id] === 'pending'}>
                        {actioning[t.id] === 'pending' ? 'Signing…' : 'Sign'}
                      </button>
                    ) : (
                      <span className="c-muted">—</span>
                    )}
                  </span>
                </div>
                {state.reason && (
                  <p className="sub c-danger" style={{ marginTop: -4 }}>Blocked: {state.reason}</p>
                )}
                {actioning[t.id] && actioning[t.id] !== 'pending' && (
                  <p className="sub c-danger" style={{ marginTop: -4 }}>{actioning[t.id]}</p>
                )}
              </div>
            )
          }
        )}
        {!managerTasks.length && <p className="sub">No clearances to sign.</p>}
      </div>
    </div>
  )
}

export function Timeline() {
  const { reports } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">Timeline</p>
      <div className="list">
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: TIMELINE_COLS }}>
          <span>Employee</span>
          <span>Role</span>
          <span style={{ textAlign: 'right' }}>Last day</span>
        </div>
        {reports.map((e) => (
          <div className="row" key={e.id} style={{ display: 'grid', gridTemplateColumns: TIMELINE_COLS, alignItems: 'center' }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.employee_name}</span>
            <span className="c-secondary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.role_title}</span>
            <span style={{ textAlign: 'right' }}>
              <span className={`tag ${dayTone(e.last_working_day)}`}>{fmtDate(e.last_working_day)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
