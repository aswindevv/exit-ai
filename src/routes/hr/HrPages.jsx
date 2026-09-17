import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import Placeholder from '../shared/Placeholder'
import { withEmployeeHeaders, tieredByCompletion, caseTaskSummary, completionChip, CASE_GATE_STAGES, EmployeeGroupHeader } from '../../components/EmployeeGroup'
import { taskClearanceStatus, CLEARANCE_TAG } from '../../lib/clearanceStatus'
import { RUNS_LIMIT } from './HrLayout'
import { runSummary, runOutcome, runStepLabel, runStepIcon } from '../../lib/agentRunText'
import { supabase } from '../../lib/supabase'
import { fmtDate } from '../../lib/format'

const HR_CLEARANCE_COLS = '1.6fr 80px 74px'
const HR_CELL_ELLIPSIS = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
// Wide enough for the longest risk pill ("Medium 100%") on one line.
const RISK_COL = 84
// The dashboard cards preview their own pages rather than repeating them.
const CASES_PREVIEW = 10
const ALERTS_PREVIEW = 4
const RUNS_PREVIEW = 8

const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', completed: 'Completed' }
const STATUS_TONE = { open: 't-neutral', in_progress: 't-accent', completed: 't-success' }
const RISK_TONE = { low: 't-success', medium: 't-warning', high: 't-danger' }
const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }
const SEVERITY_TONE = { low: 't-neutral', medium: 't-warning', high: 't-danger' }
const SENTIMENT_TONE = { positive: 't-success', neutral: 't-neutral', negative: 't-danger' }

// The analytics agents write stats as raw snake_case JSON; these turn a key or a
// value into something an HR reader can scan. Words that are acronyms in this
// product stay uppercase instead of becoming "Hr" / "It".
const STAT_ACRONYMS = { hr: 'HR', it: 'IT', kt: 'KT', sla: 'SLA' }
const humanizeStatKey = (key) =>
  STAT_ACRONYMS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const isBreakdown = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0
function fmtStatValue(key, value) {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'number' && /_(rate|pct|ratio)$/.test(key)) return `${Math.round(value * 100)}%`
  return String(value)
}

const runTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const runTimestamp = (ts) => new Date(ts).toLocaleString('en-GB', {
  weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
})

const RunOutcomeTag = ({ run }) => {
  const outcome = runOutcome(run)
  return outcome ? <span className={`tag ${outcome.tone}`}>{outcome.label}</span> : null
}

// Compact stacked form for the narrow dashboard card. The Agent activity page
// has room for real columns and uses AgentRunLine instead.
function AgentRunRow({ run, employeeName }) {
  const { text } = runSummary(run)
  return (
    <div className="row row--split row--aside">
      <div>
        <p>{employeeName} <RunOutcomeTag run={run} /></p>
        <p className="sub">{text}</p>
      </div>
      {/* Own column, or "16:07" breaks across two lines beside a long detail. */}
      <span className="c-muted row__aside" title={runTimestamp(run.created_at)}>{runTime(run.created_at)}</span>
    </div>
  )
}

// Consecutive runs for the same case, in the order they arrive.
function burstsByCase(runs) {
  const out = []
  for (const run of runs) {
    if (out.at(-1)?.caseId !== run.case_id) out.push({ caseId: run.case_id, runs: [] })
    out.at(-1).runs.push(run)
  }
  return out
}

// One run on the Agent activity page: what the agent did, in a sentence, with
// the step and any supporting line underneath and the outcome on the right.
// showRaw reveals the agent's untouched trace string for that row.
function AgentRunLine({ run, showRaw }) {
  const { text, note } = runSummary(run)
  return (
    <div className="row run-row">
      <span className="run-row__icon" aria-hidden="true">
        <i className={`ti ${runStepIcon(run.stage)}`} />
      </span>
      <span className="run-row__body">
        <span className="run-row__text">{text}</span>
        <span className="run-row__meta">
          {runStepLabel(run.stage)}{note ? ` · ${note}` : ''}
        </span>
        {showRaw && <span className="run-row__raw">{run.detail || '(no detail recorded)'}</span>}
      </span>
      <span className="run-row__status"><RunOutcomeTag run={run} /></span>
      <span className="run-row__time" title={runTimestamp(run.created_at)}>{runTime(run.created_at)}</span>
    </div>
  )
}

// The exit-cases table, shared by the dashboard card and the All exits page
// (they were duplicated line for line). `limit` previews the first N on the
// dashboard; the page passes none and renders every case.
function ExitCasesTable({ cases, limit }) {
  const rows = limit ? cases.slice(0, limit) : cases
  return (
    <div className="list">
      <div className="thead">
        <span style={{ flex: 1.4 }}>Employee</span>
        <span style={{ flex: 1 }}>Department</span>
        <span style={{ width: 56 }}>Last day</span>
        <span style={{ width: 74 }}>Status</span>
        <span style={{ width: RISK_COL, textAlign: 'right' }}>Risk (agent)</span>
      </div>
      {rows.map((c) => (
        <div className="row" key={c.id}>
          <span style={{ flex: 1.4, ...HR_CELL_ELLIPSIS }}>{c.employee_name}</span>
          <span className="c-secondary" style={{ flex: 1, ...HR_CELL_ELLIPSIS }}>{c.department}</span>
          <span className="c-secondary" style={{ width: 56 }}>{fmtDate(c.last_working_day)}</span>
          <span style={{ width: 74 }}>
            <span className={`tag ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
          </span>
          <span style={{ width: RISK_COL, textAlign: 'right' }}>
            {c.risk_level ? (
              <span className={`tag ${RISK_TONE[c.risk_level]}`}>
                {c.risk_level[0].toUpperCase() + c.risk_level.slice(1)} {Math.round(c.risk_score * 100)}%
              </span>
            ) : (
              <span className="tag t-neutral">—</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Dashboard() {
  const { profile, cases, alerts, runs, insight } = useOutletContext()
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))

  const active = cases.filter((c) => c.status !== 'completed').length
  const pendingClearances = cases.filter((c) => c.status === 'open').length
  const highRisk = cases.filter((c) => c.risk_level === 'high').length
  const completed = cases.filter((c) => c.status === 'completed').length
  const depts = new Set(cases.map((c) => c.department)).size

  const CHIPS = [
    { tone: 't-plain', k: 'Period', v: new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) },
    highRisk > 0 && { tone: 't-danger', text: `${highRisk} high risk` },
  ].filter(Boolean)

  const KPIS = [
    { label: 'Active exits', value: String(active), color: null },
    { label: 'Pending clearances', value: String(pendingClearances), color: 'var(--text-warning)' },
    { label: 'High risk', value: String(highRisk), color: 'var(--text-danger)' },
    { label: 'Completed', value: String(completed), color: 'var(--text-success)' },
  ]

  const deptCounts = {}
  for (const c of cases) deptCounts[c.department] = (deptCounts[c.department] ?? 0) + 1
  const maxDept = Math.max(1, ...Object.values(deptCounts))
  const DEPTS = Object.entries(deptCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([dept, count]) => ({ dept, count: String(count), width: `${Math.round((count / maxDept) * 100)}%` }))

  return (
    <>
      <h2 className="sr-only">
        HR exit dashboard with a sidebar nav, KPI cards, all exit cases table
        including agent risk, trend alerts, attrition by department, and an
        analytics narrative.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle={`${active} exits in progress across ${depts} departments.`}
        chips={CHIPS}
      />

      <div className="kpi-row mb">
        {KPIS.map((k) => (
          <span className="kpi" key={k.label}>
            {k.label}{' '}
            <b style={k.color ? { color: k.color } : undefined}>{k.value}</b>
          </span>
        ))}
      </div>

      {/* align-items:start — the right-hand stack is the taller column, and
          without it the cases card stretches to match, leaving a tall empty
          white panel under its last row. */}
      <div className="two-col mb" style={{ alignItems: 'start' }}>
        <div className="card card--pad">
          <p className="card-title">All exit cases</p>
          <ExitCasesTable cases={cases} limit={CASES_PREVIEW} />
          {cases.length > CASES_PREVIEW && (
            <Link className="card-more" to="/hr/all-exits">View all {cases.length} exit cases →</Link>
          )}
        </div>

        <div className="stack">
          <div className="card card--warned card--pad">
            <p className="card-title">Trend alerts</p>
            <div className="list">
              {alerts.length ? (
                alerts.slice(0, ALERTS_PREVIEW).map((a) => (
                  <div className="row row--split" key={a.id}>
                    <div>
                      <p>{a.theme}</p>
                      <p className="sub">{[a.department, a.detail].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className={`tag ${SEVERITY_TONE[a.severity]}`}>{SEVERITY_LABEL[a.severity]}</span>
                  </div>
                ))
              ) : (
                <div className="row">
                  <p className="c-muted">No trend alerts yet — the analytics agent raises them as themes emerge.</p>
                </div>
              )}
            </div>
            {alerts.length > ALERTS_PREVIEW && (
              <Link className="card-more" to="/hr/trends">View all {alerts.length} alerts →</Link>
            )}
          </div>

          <div className="card card--pad">
            <p className="card-title">Exits by department</p>
            <div className="bars">
              {DEPTS.map((d) => (
                <div key={d.dept}>
                  <div className="bar-head">
                    <span>{d.dept}</span>
                    <span className="c-muted">{d.count}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: d.width }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card card--pad">
            <p className="card-title">Agent activity</p>
            <div className="list list--col">
              {runs.length ? (
                runs.slice(0, RUNS_PREVIEW).map((r) => (
                  <AgentRunRow key={r.id} run={r} employeeName={casesById[r.case_id]?.employee_name ?? 'Unknown case'} />
                ))
              ) : (
                <div className="row">
                  <p className="c-muted">No agent activity yet — the agents log here as they work each case.</p>
                </div>
              )}
            </div>
            {runs.length > RUNS_PREVIEW && (
              <Link className="card-more" to="/hr/agent-activity">View all agent activity →</Link>
            )}
          </div>
        </div>
      </div>

      <div className="strip strip--top">
        <span className="strip-icon">
          <i className="ti ti-chart-line" aria-hidden="true" />
        </span>
        <div className="grow">
          <p className="strip-title">Analytics insight</p>
          {/* Counts come from the cases already loaded (arithmetic in code); the
              narrative is the analytics agent's own text when it has produced one. */}
          <p className="strip-body">
            {active} exits currently in progress across {depts} departments, {highRisk} flagged high risk.
            {' '}
            {insight?.narrative ?? 'Bottleneck and attrition narratives appear here once the analytics agent has run.'}
          </p>
        </div>
      </div>
    </>
  )
}

export function AllExits() {
  const { cases } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">All exit cases</p>
      <ExitCasesTable cases={cases} />
    </div>
  )
}

// Escalations are still just a special exit_tasks row (title prefix is the
// signal, per agents.supervisor._escalate / agents.service.reject_manager_task)
// -- but 0025 gave that row real reason/escalation_state columns, so the
// resolution actions below can be genuine RLS-gated writes instead of display-only.
const isEscalation = (t) => Boolean(t.title?.startsWith('Escalated'))
const ESCALATION_STATE_LABEL = { open: 'Awaiting HR review', rerouted: 'Sent back to manager', resolved: 'Resolved' }
const ESCALATION_STATE_TONE = { open: 't-danger', rerouted: 't-accent', resolved: 't-success' }

// Re-route/Resolve write straight to exit_tasks with the anon key -- RLS
// (0025's exit_tasks_hr_escalation_update) is what actually enforces "only
// HR, only from open, only to rerouted/resolved, once"; an empty returned
// row (RLS rejected it, or someone already consumed the transition) is
// treated as a failure here, never a false success. The audit POST after is
// non-fatal, matching every other agent-service call in this app.
function useEscalationAction(reload) {
  const [acting, setActing] = useState({})
  async function act(task, action, actorName) {
    setActing((a) => ({ ...a, [task.id]: 'pending' }))
    const { data, error } = await supabase
      .from('exit_tasks')
      .update({ escalation_state: action })
      .eq('id', task.id)
      .eq('escalation_state', 'open')
      .select()
    if (error || !data?.length) {
      setActing((a) => ({ ...a, [task.id]: error?.message || 'Already handled -- refresh to see current status' }))
      return
    }
    try {
      await fetch('http://localhost:8787/escalation-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: task.case_id, task_id: task.id, action, actor_name: actorName }),
      })
    } catch {
      // audit trail only -- the real transition above already succeeded
    }
    await reload()
    setActing((a) => {
      const next = { ...a }
      delete next[task.id]
      return next
    })
  }
  return [acting, act]
}

export function Escalations() {
  const { cases, tasks, profile, reload } = useOutletContext()
  const [acting, act] = useEscalationAction(reload)
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))
  const escalations = tasks
    .filter(isEscalation)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return (
    <div className="card card--pad">
      <p className="card-title">Escalations</p>
      {escalations.length ? (
        <div className="list">
          <div className="thead">
            <span style={{ flex: 1.4 }}>Employee</span>
            <span style={{ flex: 1 }}>Department</span>
            <span style={{ flex: 1.6 }}>Reason</span>
            <span style={{ width: 90 }}>Escalated</span>
            <span style={{ width: 210, textAlign: 'right' }}>Status</span>
          </div>
          {escalations.map((t) => {
            const c = casesById[t.case_id]
            const state = t.escalation_state ?? 'open'
            return (
              <div className="row" key={t.id}>
                <span style={{ flex: 1.4 }}>{c?.employee_name ?? 'Unknown case'}</span>
                <span className="c-secondary" style={{ flex: 1 }}>{c?.department ?? '—'}</span>
                <span className="c-muted" style={{ flex: 1.6 }}>{t.reason || 'Not captured'}</span>
                <span className="c-secondary" style={{ width: 90 }}>{fmtDate(t.created_at)}</span>
                <span style={{ width: 210, textAlign: 'right' }}>
                  {state === 'open' ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button
                        style={{ fontSize: 11, padding: '4px 9px' }}
                        onClick={() => act(t, 'rerouted', profile?.full_name)}
                        disabled={acting[t.id] === 'pending'}
                      >
                        {acting[t.id] === 'pending' ? 'Working…' : 'Re-route to manager'}
                      </button>
                      <button
                        className="c-danger"
                        style={{ fontSize: 11, padding: '4px 9px', borderColor: 'var(--text-danger)' }}
                        onClick={() => act(t, 'resolved', profile?.full_name)}
                        disabled={acting[t.id] === 'pending'}
                      >
                        {acting[t.id] === 'pending' ? 'Working…' : 'Resolve/Close'}
                      </button>
                    </div>
                  ) : (
                    <span className={`tag ${ESCALATION_STATE_TONE[state]}`}>{ESCALATION_STATE_LABEL[state]}</span>
                  )}
                  {acting[t.id] && acting[t.id] !== 'pending' && (
                    <p className="sub c-danger" style={{ marginTop: 2 }}>{acting[t.id]}</p>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <Placeholder title="No escalations" body="No manager has rejected a KT plan yet." />
      )}
    </div>
  )
}

export function RiskAndCompliance() {
  const { cases } = useOutletContext()
  const sorted = [...cases].sort((a, b) => (b.risk_score ?? -1) - (a.risk_score ?? -1))
  return (
    <div className="card card--pad">
      <p className="card-title">Risk and compliance</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.4 }}>Employee</span>
          <span style={{ flex: 1 }}>Department</span>
          <span style={{ width: 70 }}>Risk level</span>
          <span style={{ width: 50 }}>Score</span>
          <span style={{ width: 80, textAlign: 'right' }}>Rehire eligible</span>
        </div>
        {sorted.map((c) => (
          <div className="row" key={c.id}>
            <span style={{ flex: 1.4 }}>{c.employee_name}</span>
            <span className="c-secondary" style={{ flex: 1 }}>{c.department}</span>
            <span style={{ width: 70 }}>
              {c.risk_level ? (
                <span className={`tag ${RISK_TONE[c.risk_level]}`}>{c.risk_level[0].toUpperCase() + c.risk_level.slice(1)}</span>
              ) : (
                <span className="tag t-neutral">—</span>
              )}
            </span>
            <span className="c-secondary" style={{ width: 50 }}>{c.risk_score != null ? `${Math.round(c.risk_score * 100)}%` : '—'}</span>
            <span style={{ width: 80, textAlign: 'right' }}>
              {c.rehire_eligible == null ? (
                <span className="tag t-neutral">—</span>
              ) : (
                <span className={`tag ${c.rehire_eligible ? 't-success' : 't-danger'}`}>{c.rehire_eligible ? 'Yes' : 'No'}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExitInterviews() {
  const { cases, interviews } = useOutletContext()
  if (!interviews.length) {
    return <Placeholder title="Exit interviews" body="No exit interviews submitted yet." />
  }
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))
  return (
    <div className="card card--pad">
      <p className="card-title">Exit interviews</p>
      <div className="list list--col">
        {interviews.map((iv) => (
          <div key={iv.id} className="row row--split row--aside">
            <div>
              <p>{casesById[iv.case_id]?.employee_name ?? 'Unknown employee'}</p>
              <p className="sub">{iv.summary}</p>
              {iv.themes?.length > 0 && <p className="sub c-secondary">{iv.themes.join(', ')}</p>}
            </div>
            <span className="row__aside">
              {iv.sentiment && (
                <span className={`tag ${SENTIMENT_TONE[iv.sentiment] ?? 't-neutral'}`}>
                  {iv.sentiment[0].toUpperCase() + iv.sentiment.slice(1)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Trends() {
  const { alerts } = useOutletContext()
  if (!alerts.length) {
    return <Placeholder title="Trends" body="No trend alerts yet — the analytics agent raises them as themes emerge." />
  }
  return (
    <div className="card card--warned card--pad">
      <p className="card-title">Trend alerts</p>
      <div className="list">
        {alerts.map((a) => (
          <div className="row row--split" key={a.id}>
            <div>
              <p>{a.theme}</p>
              <p className="sub">{[a.department, a.detail].filter(Boolean).join(' · ')}</p>
            </div>
            <span className={`tag ${SEVERITY_TONE[a.severity]}`}>{SEVERITY_LABEL[a.severity]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// hr/manager/it/finance done + finance_cleared -- mirrors the SQL gate in
// public.exit_case_cleared_for_relieving() (0017), enforced server-side by
// exit_cases_hr_relieving_letter; this is just the UI's copy of that check so
// the button isn't shown for a case the write would be rejected for anyway.
// 'compliance' is excluded on purpose -- see 0017's comment.
const RELIEVING_LETTER_STAGES = ['hr', 'manager', 'it', 'finance']
function readyForRelievingLetter(c, tasks) {
  if (!c.finance_cleared || c.relieving_letter_issued) return false
  const relevant = tasks.filter((t) => t.case_id === c.id && RELIEVING_LETTER_STAGES.includes(t.stage))
  const stagesPresent = new Set(relevant.map((t) => t.stage))
  return stagesPresent.size === RELIEVING_LETTER_STAGES.length && relevant.every((t) => t.status === 'done')
}

function useIssueRelievingLetter(userId, reload) {
  const [actioning, setActioning] = useState({})
  async function issue(caseId) {
    setActioning((a) => ({ ...a, [caseId]: 'pending' }))
    const { error } = await supabase
      .from('exit_cases')
      .update({
        relieving_letter_issued: true,
        issued_at: new Date().toISOString(),
        issued_by: userId,
        status: 'completed',
      })
      .eq('id', caseId)
    if (error) {
      setActioning((a) => ({ ...a, [caseId]: error.message }))
      return
    }
    try {
      await fetch('http://localhost:8787/issue-relieving-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId }),
      })
    } catch {
      // agent service unreachable -- non-fatal, same posture as other calls
    }
    await reload()
    setActioning((a) => {
      const next = { ...a }
      delete next[caseId]
      return next
    })
  }
  return [actioning, issue]
}

export function Clearances() {
  const { cases, tasks, userId, reload } = useOutletContext()
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))
  // HR scope: finance-stage rows ("Clear final settlement dues") are Finance's
  // to clear and belong on the Finance queue, not here.
  const hrTasks = tasks.filter((t) => t.stage === 'hr')
  const [actioning, issue] = useIssueRelievingLetter(userId, reload)
  const ready = cases.filter((c) => readyForRelievingLetter(c, tasks))

  return (
    <>
      <div className="card card--pad mb">
        <p className="card-title">Clearances</p>
        <div className="list">
          <div className="thead" style={{ display: 'grid', gridTemplateColumns: HR_CLEARANCE_COLS }}>
            <span>Task</span>
            <span>Due</span>
            <span style={{ textAlign: 'right' }}>Status</span>
          </div>
          {withEmployeeHeaders(
            tieredByCompletion(
              [...hrTasks],
              (t) => caseTaskSummary(t.case_id, tasks, CASE_GATE_STAGES).allDone,
              (t) => new Date(casesById[t.case_id]?.created_at ?? 0)
            ),
            (t) => t.case_id,
            (t) => {
              const c = casesById[t.case_id]
              return {
                name: c?.employee_name ?? '—',
                subtitle: c ? `${c.department} · Last day ${fmtDate(c.last_working_day)}` : undefined,
                chip: completionChip(t.case_id, tasks, CASE_GATE_STAGES),
              }
            },
            (t) => {
              const state = taskClearanceStatus(t, tasks)
              const tag = CLEARANCE_TAG[state.key]
              return (
                <div key={t.id}>
                  <div className="row" style={{ display: 'grid', gridTemplateColumns: HR_CLEARANCE_COLS, alignItems: 'center' }}>
                    <span className="c-secondary" style={HR_CELL_ELLIPSIS}>{t.title}</span>
                    <span className="c-secondary">{t.due_date ? fmtDate(t.due_date) : '—'}</span>
                    <span style={{ textAlign: 'right' }}>
                      <span className={`tag ${tag.tone}`}>{tag.label}</span>
                    </span>
                  </div>
                  {state.reason && (
                    <p className="sub c-danger" style={{ marginTop: -4 }}>Blocked: {state.reason}</p>
                  )}
                </div>
              )
            }
          )}
          {!hrTasks.length && <p className="sub">No HR clearance items.</p>}
        </div>
      </div>

      <div className="card card--pad">
        <p className="card-title">Ready to close</p>
        <div className="list">
          {ready.map((c) => (
            <div className="row row--split" key={c.id}>
              <div>
                <p>{c.employee_name}</p>
                <p className="sub">All stages cleared · Last day {fmtDate(c.last_working_day)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <button
                  style={{ fontSize: 11, padding: '4px 9px' }}
                  onClick={() => issue(c.id)}
                  disabled={actioning[c.id] === 'pending'}
                >
                  {actioning[c.id] === 'pending' ? 'Issuing…' : 'Issue relieving letter'}
                </button>
                {actioning[c.id] && actioning[c.id] !== 'pending' && (
                  <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[c.id]}</p>
                )}
              </div>
            </div>
          ))}
          {cases.filter((c) => c.relieving_letter_issued).map((c) => (
            <div className="row row--split" key={c.id}>
              <div>
                <p>{c.employee_name}</p>
                <p className="sub">Issued {fmtDate(c.issued_at)}</p>
              </div>
              <span className="tag t-success">Issued</span>
            </div>
          ))}
          {!ready.length && !cases.some((c) => c.relieving_letter_issued) && (
            <p className="sub">No cases ready to close yet.</p>
          )}
        </div>
      </div>
    </>
  )
}

// Policy Compliance Auditor (#22). Its three checks, in the order the CLI's
// format_report prints them (agents/policy_auditor.py CHECKS) so the page and
// the terminal read the same way. Listed even at zero, so "checked, clean" is
// distinguishable from "not checked".
const AUDIT_CHECKS = [
  { key: 'sla_breach', label: 'SLA breach', sub: 'Pending task 5+ days overdue' },
  { key: 'missing_approval', label: 'Missing approval', sub: 'Past the manager gate with no logged approval' },
  { key: 'skipped_step', label: 'Skipped step', sub: 'Finance stage reached without the compliance check' },
]

export function PolicyAudit() {
  // HrLayout pins this read to agent_type='policy_compliance_auditor' (0029),
  // so #14/#17/#23's rows in the same table can never show up here.
  const { audit } = useOutletContext()
  if (!audit) {
    return (
      <Placeholder
        title="Policy audit"
        body="No audit has been run yet — generate one with `python -m agents.policy_auditor` (agent #22)."
      />
    )
  }
  const stats = audit.stats && typeof audit.stats === 'object' ? audit.stats : {}
  const byCheck = stats.breaches_by_check ?? {}
  const breaches = Array.isArray(stats.breaches) ? stats.breaches : []
  const total = stats.breach_count ?? 0
  const ran = new Date(audit.created_at)

  return (
    <>
      <div className="kpi-row mb">
        <span className="kpi">
          Cases audited <b>{stats.cases_audited ?? 0}</b>
        </span>
        <span className="kpi">
          Breaches found <b className={total ? 'c-danger' : 'c-success'}>{total}</b>
        </span>
        <span className="kpi">
          Last run <b>{fmtDate(audit.created_at)}</b>
        </span>
      </div>

      <div className="card card--pad mb">
        <p className="card-title">Breaches by check</p>
        <div className="list">
          {AUDIT_CHECKS.map((c) => {
            const n = byCheck[c.key] ?? 0
            return (
              <div className="row row--split" key={c.key}>
                <div>
                  <p>{c.label}</p>
                  <p className="sub">{c.sub}</p>
                </div>
                <span className={`tag ${n ? 't-danger' : 't-success'}`}>{n}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="strip strip--top mb">
        <span className="strip-icon">
          <i className="ti ti-shield-search" aria-hidden="true" />
        </span>
        <div className="grow">
          <p className="strip-title">Recommendation</p>
          <p className="strip-body">{audit.narrative}</p>
        </div>
      </div>

      {breaches.length > 0 && (
        <div className="card card--pad">
          <p className="card-title">Breach detail</p>
          <div className="list">
            {breaches.map((b, i) => (
              <div className="row row--split" key={`${b.case_id}-${b.check}-${i}`}>
                <div>
                  <p>{b.employee_name}</p>
                  <p className="sub">{typeof b.detail === 'string' ? b.detail : auditBreachDetail(b.detail)}</p>
                </div>
                <span className="tag t-neutral">
                  {AUDIT_CHECKS.find((c) => c.key === b.check)?.label ?? b.check}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="sub c-muted" style={{ marginTop: 10 }}>
        Audit generated {ran.toLocaleString('en-GB')} by the Policy Compliance Auditor, on demand.
      </p>
    </>
  )
}

// sla_breach rows carry sla_escalation.find_breaches' own object rather than a
// sentence -- same rendering as the CLI's _detail_line.
function auditBreachDetail(d) {
  if (!d || typeof d !== 'object') return String(d ?? '')
  return `"${d.title ?? '?'}" (${d.stage ?? '?'}) — ${d.days_overdue ?? '?'} days overdue, blocked by ${d.blocker ?? '?'}`
}

export function Reports() {
  const { insight } = useOutletContext()
  if (!insight) {
    return <Placeholder title="Reports" body="No analytics report generated yet — the analytics agent writes one once it has run." />
  }
  // stats is the agent's own JSON, so stay generic over whatever keys it emits:
  // a plain value is a headline number, a nested object is a {label: count}
  // breakdown that reads as bars rather than as a JSON blob.
  const entries = insight.stats && typeof insight.stats === 'object' ? Object.entries(insight.stats) : []
  const headline = entries.filter(([, v]) => !isBreakdown(v))
  const breakdowns = entries.filter(([, v]) => isBreakdown(v))

  return (
    <>
      <div className="card card--pad mb">
        <p className="card-title">Reports</p>
        <p className="c-secondary">{insight.narrative}</p>
        {insight.created_at && (
          <p className="c-muted" style={{ fontSize: 11, marginBottom: 0, marginTop: 8 }}>
            Generated {new Date(insight.created_at).toLocaleString('en-GB', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        )}
      </div>

      {headline.length > 0 && (
        <div className="kpi-row mb">
          {headline.map(([k, v]) => (
            <span className="kpi" key={k}>
              {humanizeStatKey(k)} <b>{fmtStatValue(k, v)}</b>
            </span>
          ))}
        </div>
      )}

      <div className="two-col two-col--even" style={{ alignItems: 'start' }}>
        {breakdowns.map(([key, value]) => {
          const rows = Object.entries(value).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
          const max = Math.max(1, ...rows.map(([, n]) => Number(n) || 0))
          return (
            <div className="card card--pad" key={key}>
              <p className="card-title">{humanizeStatKey(key)}</p>
              <div className="bars">
                {rows.map(([rowKey, count]) => (
                  <div key={rowKey}>
                    <div className="bar-head">
                      <span>{humanizeStatKey(rowKey)}</span>
                      <span className="c-muted">{count}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${Math.round(((Number(count) || 0) / max) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// Every agent run HR can see, newest first, grouped by day and filterable by
// pipeline stage. The dashboard card is the newest few of this same list.
export function AgentActivity() {
  const { cases, runs } = useOutletContext()
  const [stage, setStage] = useState('all')
  const [showRaw, setShowRaw] = useState(false)
  if (!runs.length) {
    return <Placeholder title="Agent activity" body="No agent activity yet — the agents log here as they work each case." />
  }
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))
  const stages = [...new Set(runs.map((r) => r.stage))].sort((a, b) =>
    runStepLabel(a).localeCompare(runStepLabel(b)))
  const shown = stage === 'all' ? runs : runs.filter((r) => r.stage === stage)

  // runs arrive newest-first, so walking them in order gives the day headings
  // in order too.
  const days = []
  for (const run of shown) {
    const key = run.created_at.slice(0, 10)
    if (days.at(-1)?.key !== key) days.push({ key, runs: [] })
    days.at(-1).runs.push(run)
  }
  const today = new Date().toISOString().slice(0, 10)
  const dayLabel = (key) =>
    key === today ? 'Today' : new Date(key).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })

  return (
    <div className="card card--pad">
      <p className="card-title">
        Agent activity
        <span className="card-title-count t-neutral">{shown.length} action{shown.length === 1 ? '' : 's'}</span>
      </p>
      <p className="card-sub" style={{ margin: '0 0 14px' }}>
        What the agents have done on your exit cases, newest first.
      </p>

      <div className="run-controls">
        <div className="field">
          <label htmlFor="run-stage">Filter by step</label>
          <select id="run-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="all">All steps</option>
            {stages.map((s) => (
              <option key={s} value={s}>{runStepLabel(s)}</option>
            ))}
          </select>
        </div>
        {/* The sentences are a reading of the agent's own trace string, so the
            untouched string stays one click away rather than being replaced. */}
        <label className="run-raw-toggle">
          <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} />
          Show raw agent output
        </label>
      </div>

      {days.map((day) => (
        <div key={day.key} className="list list--col">
          <p className="run-day">{dayLabel(day.key)}</p>
          {/* Runs for one case arrive in a burst, so the employee goes in a
              header above their own runs instead of repeating on every line.
              Grouped here rather than with withEmployeeHeaders: a case can
              have two bursts in one day, and that helper keys its headers by
              case id alone. */}
          {burstsByCase(day.runs).map((burst) => (
            <div key={burst.runs[0].id}>
              <EmployeeGroupHeader
                name={casesById[burst.caseId]?.employee_name ?? 'Unknown case'}
                subtitle={casesById[burst.caseId]?.department}
              />
              {burst.runs.map((r) => <AgentRunLine key={r.id} run={r} showRaw={showRaw} />)}
            </div>
          ))}
        </div>
      ))}

      {runs.length >= RUNS_LIMIT && (
        <p className="c-muted" style={{ fontSize: 11, marginTop: 12 }}>
          Showing the {RUNS_LIMIT} most recent runs.
        </p>
      )}
    </div>
  )
}

export function Settings() {
  return <Placeholder title="Settings" body="Workspace settings aren't built yet." />
}
