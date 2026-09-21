import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { withEmployeeHeaders, tieredByCompletion, caseTaskSummary, completionChip, CASE_GATE_STAGES } from '../../components/EmployeeGroup'
import {
  managerStageTasks,
  isEscalationRow,
  hasOpenEscalation,
  clearanceRows,
  CLEARANCE_STATE_TAG,
} from '../../lib/ktScope'
import { supabase } from '../../lib/supabase'
import { fmtDate, daysUntil } from '../../lib/format'

const BTN = { fontSize: 11, padding: '4px 9px' }

// The dashboard cards are a preview of the KT approvals / Clearances pages,
// not a second copy of them: show the top of each queue and link to the page
// for the rest, so the dashboard stays a dashboard.
const KT_PREVIEW = 6
const CLEARANCE_PREVIEW = 5
const TEAM_PREVIEW = 8

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
// One row per EMPLOYEE now, not per task: employee · KT progress · state · action.
const CLEARANCE_COLS = '1.5fr 1fr 110px 118px'

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

// KT approval (manager "Review") is just approving a task -- mark it done.
// RLS (0008) only lets a manager do this for their own reports'
// manager/finance-stage tasks, and only to 'done', so this can't be used to
// un-approve or touch other rows. Clearance sign-off no longer goes through
// here: it is one per employee, not per task (see useSignClearance).
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
// agent service, which mirrors agents.hub.supervisor._escalate's insert. Unlike
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

// The manager's ONE formal sign-off for an employee, replacing the old
// per-KT-task "Sign" buttons. It performs no write of its own: every KT task
// is already 'done' (the Review button did that), so all that is left is the
// manager->IT handoff, which is exactly what /manager-approve is. That
// endpoint re-checks in the database that the case has no open escalation and
// that every KT task is done before it advances, and its IT-stage generation
// is idempotent -- so this is a trigger for the existing gate, not a second
// decision and not a bypass.
//
// Unlike useApprove's fetch (where the status write already stuck and the
// call is a best-effort follow-up), this one is NOT non-fatal: it is the only
// thing the click does, so a service failure or a refusal to advance has to
// surface in the UI.
function useSignClearance(reload) {
  const [signing, setSigning] = useState({})
  async function signClearance(caseId) {
    setSigning((s) => ({ ...s, [caseId]: 'pending' }))
    try {
      const res = await fetch('http://localhost:8787/manager-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        setSigning((s) => ({ ...s, [caseId]: data.error || `Sign-off failed (HTTP ${res.status})` }))
        return
      }
      if (data.advanced === false) {
        setSigning((s) => ({ ...s, [caseId]: `Not advanced -- ${data.reason}` }))
        return
      }
    } catch (err) {
      setSigning((s) => ({ ...s, [caseId]: `Agent service unreachable -- ${err.message}` }))
      return
    }
    await reload()
    setSigning((s) => {
      const next = { ...s }
      delete next[caseId]
      return next
    })
  }
  return [signing, signClearance]
}

// The team table, shared by the dashboard card and the My team page (they
// were duplicated line for line). `limit` previews the soonest leavers on the
// dashboard; the page passes none and lists everyone.
function TeamExitsTable({ reports, limit }) {
  const rows = limit ? reports.slice(0, limit) : reports
  return (
    <div className="list">
      <div className="thead" style={{ display: 'grid', gridTemplateColumns: TEAM_COLS }}>
        <span>Employee</span>
        <span>Role</span>
        <span>Department</span>
        <span style={{ textAlign: 'right' }}>Last day</span>
      </div>
      {rows.map((e) => (
        <div className="row" key={e.id} style={{ display: 'grid', gridTemplateColumns: TEAM_COLS, alignItems: 'center' }}>
          <span style={CELL_ELLIPSIS}>{e.employee_name}</span>
          <span className="c-secondary" style={CELL_ELLIPSIS}>{e.role_title}</span>
          <span className="c-secondary" style={CELL_ELLIPSIS}>{e.department}</span>
          <span style={{ textAlign: 'right' }}>
            <span className={`tag ${dayTone(e.last_working_day)}`}>{fmtDate(e.last_working_day)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// One KT task row, shared by the dashboard card and the KT approvals page so
// the two queues can't drift apart (they were duplicated line for line). The
// `.row` class, the Review/Reject labels and the Escalated/Approved tag text
// are read by scripts/verify/verify_manager_kt_clearances.cjs -- keep them.
function KtTaskRow({ task, tasks, actioning, approveTask, rejecting, rejectTask }) {
  const escalated = isEscalationRow(task) || hasOpenEscalation(task.case_id, tasks)
  const done = task.status === 'done'
  const busy = actioning[task.id] === 'pending' || rejecting[task.id] === 'pending'
  const errors = [actioning[task.id], rejecting[task.id]].filter((m) => m && m !== 'pending')
  return (
    <div>
      <div className={`row kt-row${done && !escalated ? ' kt-row--done' : ''}`}>
        <span className="kt-row__title">{task.title}</span>
        <span className="kt-row__due">{task.due_date ? fmtDate(task.due_date) : ''}</span>
        <span className="kt-row__action">
          {escalated ? (
            <span className="tag t-danger">Escalated to HR</span>
          ) : done ? (
            <span className="tag t-success">Approved</span>
          ) : (
            <>
              <button className="btn-approve" style={BTN} onClick={() => approveTask(task)} disabled={busy}>
                {actioning[task.id] === 'pending' ? 'Approving…' : 'Review'}
              </button>
              <button
                className="c-danger"
                style={{ ...BTN, borderColor: 'var(--text-danger)' }}
                onClick={() => rejectTask(task.id, task.case_id)}
                disabled={busy}
              >
                {rejecting[task.id] === 'pending' ? 'Rejecting…' : 'Reject'}
              </button>
            </>
          )}
        </span>
      </div>
      {errors.map((msg) => (
        <p className="sub c-danger" key={msg} style={{ marginTop: -2 }}>{msg}</p>
      ))}
    </div>
  )
}

// The employee-level clearance list, shared by the dashboard card and the
// Clearances page so the two can never disagree about who is signable.
function ClearanceSignOff({ reports, tasks, signing, signClearance, withHeader, limit }) {
  // clearanceRows sorts signable-first, so a limited preview on the dashboard
  // shows what needs the manager, never a truncated alphabet.
  const all = clearanceRows(reports, tasks)
  const rows = limit ? all.slice(0, limit) : all
  return (
    <div className="list">
      {withHeader && (
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: CLEARANCE_COLS }}>
          <span>Employee</span>
          <span>KT approvals</span>
          <span style={{ textAlign: 'right' }}>Status</span>
          <span style={{ textAlign: 'right' }}>Action</span>
        </div>
      )}
      {rows.map(({ report, state }) => {
        const tag = CLEARANCE_STATE_TAG[state.key]
        const ready = state.key === 'ready'
        return (
          <div key={report.id} data-clearance-case={report.id}>
            <div className="row" style={{ display: 'grid', gridTemplateColumns: CLEARANCE_COLS, alignItems: 'center' }}>
              <span style={{ ...CELL_ELLIPSIS, fontWeight: ready ? 500 : undefined }}>{report.employee_name}</span>
              {/* Counts plus a bar: the ratio is what the manager scans for, and
                  it replaces a sub-line that only restated these same numbers. */}
              <span className="clr-progress">
                <span className="c-secondary" style={CELL_ELLIPSIS}>
                  {state.total ? `${state.approved} of ${state.total} approved` : 'No KT tasks yet'}
                </span>
                {state.total > 0 && (
                  <span className="bar-track">
                    <span
                      className={`bar-fill${state.approved === state.total ? ' bar-fill--success' : ''}`}
                      style={{ width: `${Math.round((state.approved / state.total) * 100)}%` }}
                    />
                  </span>
                )}
              </span>
              <span style={{ textAlign: 'right' }}>
                <span className={`tag ${tag.tone}`}>{tag.label}</span>
              </span>
              <span style={{ textAlign: 'right' }}>
                {ready && (
                  <button className="btn-approve" style={BTN} onClick={() => signClearance(report.id)} disabled={signing[report.id] === 'pending'}>
                    {signing[report.id] === 'pending' ? 'Signing…' : 'Sign clearance'}
                  </button>
                )}
              </span>
            </div>
            {signing[report.id] && signing[report.id] !== 'pending' && (
              <p className="sub c-danger" style={{ marginTop: -4 }}>{signing[report.id]}</p>
            )}
          </div>
        )
      })}
      {!rows.length && <p className="sub">No clearances to sign.</p>}
    </div>
  )
}

export function Dashboard() {
  const { profile, reports, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const [rejecting, rejectTask] = useReject(reload)
  const [signing, signClearance] = useSignClearance(reload)
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const reportsById = Object.fromEntries(reports.map((r) => [r.id, r]))

  // Manager scope: stage='manager' only. IT/finance/compliance rows belong to
  // their own dashboards and are never actionable here.
  const ktTasks = managerStageTasks(tasks)
  const ktPending = ktTasks.filter((t) => t.status !== 'done')
  const ktToReview = ktPending.length
  // Preview only what still needs the manager — already-approved rows are on
  // the KT approvals page, one click away.
  const ktPreview = tieredByCompletion(ktPending, mgrKtAllDone(ktTasks), mgrCreatedAt(reportsById)).slice(0, KT_PREVIEW)
  // One sign-off per employee, not per task -- countable only when every one
  // of that employee's KT tasks is approved and the case has not advanced.
  const toSign = clearanceRows(reports, tasks).filter((r) => r.state.key === 'ready')

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
        <TeamExitsTable reports={reports} limit={TEAM_PREVIEW} />
        {reports.length > TEAM_PREVIEW && (
          <Link className="card-more" to="/manager/my-team">View all {reports.length} exiting reports →</Link>
        )}
      </div>

      <div className="two-col two-col--even mb">
        <div className="card card--pad">
          <p className="card-title">
            KT approvals
            {ktToReview > 0 && <span className="card-title-count t-warning">{ktToReview} pending</span>}
          </p>
          <div className="list">
            {ktPreview.length === 0 && <p className="sub">Nothing awaiting your review.</p>}
            {withEmployeeHeaders(
              ktPreview,
              mgrGroupKey,
              mgrGroupHeader(reportsById, tasks),
              (t) => (
                <KtTaskRow
                  key={t.id}
                  task={t}
                  tasks={tasks}
                  actioning={actioning}
                  approveTask={approveTask}
                  rejecting={rejecting}
                  rejectTask={rejectTask}
                />
              )
            )}
          </div>
          {ktToReview > KT_PREVIEW && (
            <Link className="card-more" to="/manager/kt-approvals">View all {ktToReview} KT approvals →</Link>
          )}
        </div>

        <div className="card card--pad">
          <p className="card-title">
            Clearances to sign
            {toSign.length > 0 && <span className="card-title-count t-accent">{toSign.length} ready</span>}
          </p>
          <ClearanceSignOff
            reports={reports}
            tasks={tasks}
            signing={signing}
            signClearance={signClearance}
            limit={CLEARANCE_PREVIEW}
          />
          {reports.length > CLEARANCE_PREVIEW && (
            <Link className="card-more" to="/manager/clearances">View all {reports.length} employees →</Link>
          )}
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
            {reports.length} exiting report{reports.length === 1 ? '' : 's'}. Gap analysis appears here once the
            exiting employee submits their KT documents.
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
      <TeamExitsTable reports={reports} />
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
  // stage='manager' only -- IT, finance and compliance rows are their own
  // dashboards' queues and must never appear here.
  const ktTasks = managerStageTasks(tasks)
  return (
    <div className="card card--pad">
      <p className="card-title">KT approvals</p>
      <div className="list">
        {withEmployeeHeaders(
          tieredByCompletion([...ktTasks], mgrKtAllDone(ktTasks), mgrCreatedAt(reportsById)),
          mgrGroupKey,
          mgrGroupHeader(reportsById, tasks),
          (t) => (
            <KtTaskRow
              key={t.id}
              task={t}
              tasks={tasks}
              actioning={actioning}
              approveTask={approveTask}
              rejecting={rejecting}
              rejectTask={rejectTask}
            />
          )
        )}
      </div>
    </div>
  )
}

// One final sign-off PER EMPLOYEE -- not a second list of the individual KT
// tasks that KT approvals already actions. The manager approves each KT task
// once (Review), then signs the employee's clearance once, which is the
// manager->IT handoff.
export function Clearances() {
  const { reports, tasks, reload } = useOutletContext()
  const [signing, signClearance] = useSignClearance(reload)
  return (
    <div className="card card--pad">
      <p className="card-title">Clearances to sign</p>
      <ClearanceSignOff
        reports={reports}
        tasks={tasks}
        signing={signing}
        signClearance={signClearance}
        withHeader
      />
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
