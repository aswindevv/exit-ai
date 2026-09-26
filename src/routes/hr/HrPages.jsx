import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { runOutcome, runStepIcon, runStepLabel, runSummary } from '../../lib/agentRunText'
import { supabase } from '../../lib/supabase'

const STAGES = ['hr', 'manager', 'it', 'compliance', 'finance', 'relieving']
const STAGE_LABEL = {
  hr: 'HR', manager: 'Manager & KT', it: 'IT', compliance: 'Compliance', finance: 'Finance', relieving: 'Relieving',
}
const STAGE_OWNER = {
  hr: 'HR', manager: 'Manager', it: 'IT', compliance: 'HR', finance: 'Finance', relieving: 'HR',
}
const RISK_TONE = { low: 'success', medium: 'warning', high: 'danger' }
const SENTIMENT_TONE = { positive: 'success', neutral: 'neutral', negative: 'danger' }
const REQUIRED_DOCS_BASE = ['NDA', 'Asset Return Form']
const REQUIRED_DOCS_EXTRA = { IT: ['Company Asset Declaration'], Engineering: ['Company Asset Declaration'] }
const PAGE_SIZE = 25
const CASE_TABS = [
  ['overview', 'Overview'], ['tasks', 'Tasks'], ['documents', 'Documents'],
  ['interview', 'Exit interview'], ['risk', 'Risk & compliance'], ['audit', 'Audit trail'],
]

const startOfToday = () => new Date(new Date().toDateString())
const dayDiff = (value) => value ? Math.round((new Date(value) - startOfToday()) / 86400000) : null
const formatDate = (value) => value
  ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : ''
const formatDateTime = (value) => value
  ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : ''
const ageLabel = (value) => {
  if (!value) return ''
  const days = Math.max(0, Math.floor((startOfToday() - new Date(value)) / 86400000))
  if (days === 0) return 'Today'
  return `${days} day${days === 1 ? '' : 's'}`
}
const daysLabel = (value) => {
  const days = dayDiff(value)
  if (days == null) return ''
  if (days === 0) return 'today'
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
}
const humanize = (value = '') => value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
const riskScore = (value) => value == null ? 'Not assessed yet' : Number(value).toFixed(2)
const assessmentText = (value) => value == null || value === '' ? 'Not assessed yet' : value
const tasksForCase = (caseId, tasks) => tasks.filter((task) => task.case_id === caseId)
const isEscalation = (task) => Boolean(task.title?.startsWith('Escalated'))
export const isOpenEscalation = (task) => isEscalation(task) && (task.escalation_state ?? 'open') === 'open'

const RELIEVING_STAGES = ['hr', 'manager', 'it', 'finance']
export function readyForRelievingLetter(exitCase, tasks) {
  if (!exitCase.finance_cleared || exitCase.relieving_letter_issued) return false
  if (tasksForCase(exitCase.id, tasks).some(isOpenEscalation)) return false
  const relevant = tasksForCase(exitCase.id, tasks).filter((task) => RELIEVING_STAGES.includes(task.stage) && !isEscalation(task))
  const present = new Set(relevant.map((task) => task.stage))
  return RELIEVING_STAGES.every((stage) => present.has(stage)) && relevant.every((task) => task.status === 'done')
}

function blockedReason(exitCase, tasks) {
  if (exitCase.finance_rejected) return exitCase.dues_note || 'Finance has placed this case on hold.'
  const task = tasksForCase(exitCase.id, tasks).find((item) =>
    item.status !== 'done' && ['compliance', 'finance'].includes(item.stage) && /blocked/i.test(item.title || ''))
  if (!task) return ''
  return task.title.replace(/^Final clearance blocked:\s*/i, '').replace(/^.*?blocked\s*[-—:]\s*/i, '')
}

function overdueTasks(exitCase, tasks) {
  return tasksForCase(exitCase.id, tasks)
    .filter((task) => !isEscalation(task) && task.status !== 'done' && task.due_date && dayDiff(task.due_date) < 0)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
}

function currentStage(exitCase, tasks) {
  if (exitCase.relieving_letter_issued || exitCase.status === 'completed') return 'relieving'
  if (tasksForCase(exitCase.id, tasks).some(isOpenEscalation)) return 'manager'
  if (exitCase.finance_rejected) return 'finance'
  const ownTasks = tasksForCase(exitCase.id, tasks).filter((task) => !isEscalation(task))
  const blockedTask = ownTasks.find((task) =>
    task.status !== 'done' && ['compliance', 'finance'].includes(task.stage) && /blocked/i.test(task.title || ''))
  if (blockedTask) return blockedTask.stage
  for (const stage of STAGES.slice(0, -1)) {
    const stageTasks = ownTasks.filter((task) => task.stage === stage)
    if (stageTasks.length && stageTasks.some((task) => task.status !== 'done')) return stage
  }
  return 'relieving'
}

function caseStatus(exitCase, tasks) {
  if (exitCase.relieving_letter_issued || exitCase.status === 'completed') return { key: 'completed', label: 'Completed', tone: 'success' }
  if (tasksForCase(exitCase.id, tasks).some(isOpenEscalation)) return { key: 'escalated', label: 'Escalated', tone: 'danger' }
  if (blockedReason(exitCase, tasks)) return { key: 'blocked', label: 'Blocked', tone: 'danger' }
  if (readyForRelievingLetter(exitCase, tasks)) return { key: 'ready', label: 'Ready', tone: 'success' }
  return { key: 'in_progress', label: 'In progress', tone: 'info' }
}

function progressForCase(exitCase, tasks) {
  const rows = tasksForCase(exitCase.id, tasks).filter((task) => !isEscalation(task))
  const done = rows.filter((task) => task.status === 'done').length
  return { done, total: rows.length, percent: rows.length ? Math.round((done / rows.length) * 100) : 0 }
}

function stageStates(exitCase, tasks) {
  if (exitCase.relieving_letter_issued || exitCase.status === 'completed') {
    return STAGES.map((key) => ({ key, label: STAGE_LABEL[key], state: 'done' }))
  }
  const active = currentStage(exitCase, tasks)
  const activeIndex = STAGES.indexOf(active)
  const caseTasks = tasksForCase(exitCase.id, tasks)
  return STAGES.map((key, index) => {
    const rows = caseTasks.filter((task) => task.stage === key && !isEscalation(task))
    const complete = rows.length > 0 && rows.every((task) => task.status === 'done')
    if (index < activeIndex && complete) return { key, label: STAGE_LABEL[key], state: 'done' }
    if (index === activeIndex) {
      const blocked = (key === 'manager' && caseTasks.some(isOpenEscalation)) ||
        (['compliance', 'finance'].includes(key) && Boolean(blockedReason(exitCase, tasks)))
      return { key, label: STAGE_LABEL[key], state: blocked ? 'blocked' : 'current' }
    }
    return { key, label: STAGE_LABEL[key], state: 'pending' }
  })
}

function attentionItems(cases, tasks) {
  const items = []
  const seen = new Set()
  const activeCases = cases.filter((exitCase) => exitCase.status !== 'completed' && !exitCase.relieving_letter_issued)
  const casesById = Object.fromEntries(activeCases.map((exitCase) => [exitCase.id, exitCase]))
  const add = (item) => { if (item.case && !seen.has(item.case.id)) { seen.add(item.case.id); items.push(item) } }

  tasks.filter(isOpenEscalation).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach((task) => add({
    kind: 'Open escalation', tone: 'danger', case: casesById[task.case_id],
    reason: task.reason || 'A manager review needs an HR decision.', age: ageLabel(task.created_at),
    action: 'Review', href: `/hr/escalations#${task.id}`,
  }))
  activeCases.filter((exitCase) => readyForRelievingLetter(exitCase, tasks)).forEach((exitCase) => add({
    kind: 'Ready for relieving', tone: 'success', case: exitCase,
    reason: 'All required clearances are complete.', action: 'Issue letter', issue: true,
  }))
  activeCases.forEach((exitCase) => {
    const task = overdueTasks(exitCase, tasks)[0]
    if (task) add({
      kind: 'Overdue task', tone: 'warning', case: exitCase, reason: task.title,
      age: `${Math.abs(dayDiff(task.due_date))} day${Math.abs(dayDiff(task.due_date)) === 1 ? '' : 's'} overdue`,
      action: 'Open case', href: `/hr/exits/${exitCase.id}`,
    })
  })
  activeCases.forEach((exitCase) => {
    const reason = blockedReason(exitCase, tasks)
    if (reason) add({ kind: 'Blocked', tone: 'danger', case: exitCase, reason, action: 'Open case', href: `/hr/exits/${exitCase.id}` })
  })
  return items
}

function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`hr-badge hr-badge--${tone}`}>{children}</span>
}

function EmptyState({ icon = 'ti-inbox', title, body }) {
  return <div className="hr-empty"><i className={`ti ${icon}`} aria-hidden="true" /><strong>{title}</strong>{body && <span>{body}</span>}</div>
}

function PageHeader({ title, description, action }) {
  return <header className="hr-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(onClose, 4500)
    return () => window.clearTimeout(timer)
  }, [toast, onClose])
  if (!toast) return null
  return <div className={`hr-toast hr-toast--${toast.tone || 'success'}`} role="status"><i className={`ti ${toast.tone === 'danger' ? 'ti-alert-circle' : 'ti-circle-check'}`} aria-hidden="true" /><span>{toast.message}</span><button type="button" onClick={onClose} aria-label="Dismiss"><i className="ti ti-x" /></button></div>
}

function ConfirmDialog({ config, busy, onCancel, onConfirm }) {
  if (!config) return null
  return <div className="hr-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}><section className="hr-dialog" role="dialog" aria-modal="true" aria-labelledby="hr-dialog-title"><span className="hr-dialog__icon"><i className={`ti ${config.icon || 'ti-alert-triangle'}`} /></span><h2 id="hr-dialog-title">{config.title}</h2><p>{config.body}</p><div><button type="button" className="hr-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="hr-button hr-button--primary" onClick={onConfirm} disabled={busy} autoFocus>{busy ? 'Working…' : config.confirmLabel}</button></div></section></div>
}

function useIssueRelievingLetter(userId, reload) {
  const [actioning, setActioning] = useState({})
  async function issue(caseId) {
    setActioning((current) => ({ ...current, [caseId]: true }))
    const { error } = await supabase.from('exit_cases').update({
      relieving_letter_issued: true,
      issued_at: new Date().toISOString(),
      issued_by: userId,
      status: 'completed',
    }).eq('id', caseId)
    if (error) {
      setActioning((current) => ({ ...current, [caseId]: false }))
      return { ok: false, message: error.message }
    }
    try {
      await fetch('http://localhost:8787/issue-relieving-letter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case_id: caseId }),
      })
    } catch {
      // The database transition succeeded; notification delivery is non-fatal.
    }
    await reload()
    setActioning((current) => ({ ...current, [caseId]: false }))
    return { ok: true, message: 'Relieving letter issued successfully.' }
  }
  return [actioning, issue]
}

function useEscalationAction(reload) {
  const [acting, setActing] = useState({})
  async function act(task, action, actorName) {
    setActing((current) => ({ ...current, [task.id]: true }))
    const { data, error } = await supabase.from('exit_tasks').update({ escalation_state: action })
      .eq('id', task.id).eq('escalation_state', 'open').select()
    if (error || !data?.length) {
      setActing((current) => ({ ...current, [task.id]: false }))
      return { ok: false, message: error?.message || 'This escalation was already handled.' }
    }
    try {
      await fetch('http://localhost:8787/escalation-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: task.case_id, task_id: task.id, action, actor_name: actorName }),
      })
    } catch {
      // The database transition succeeded; audit delivery is non-fatal.
    }
    await reload()
    setActing((current) => ({ ...current, [task.id]: false }))
    return { ok: true, message: action === 'rerouted' ? 'Escalation re-routed to the manager.' : 'Escalation resolved.' }
  }
  return [acting, act]
}

function activityEvents(data, caseId = null) {
  const casesById = Object.fromEntries(data.cases.map((exitCase) => [exitCase.id, exitCase]))
  const inScope = (id) => !caseId || id === caseId
  return [
    ...data.runs.filter((run) => inScope(run.case_id)).map((run) => {
      const summary = runSummary(run)
      return { id: `run-${run.id}`, caseId: run.case_id, at: run.created_at, type: 'agent', icon: runStepIcon(run.stage), title: summary.text, detail: summary.note, label: runStepLabel(run.stage), outcome: runOutcome(run) }
    }),
    ...data.documents.filter((document) => inScope(document.case_id)).map((document) => ({ id: `document-${document.id}`, caseId: document.case_id, at: document.created_at, type: 'people', icon: 'ti-file-upload', title: `${document.doc_type} uploaded`, detail: document.status === 'validated' ? 'Document validated' : document.status === 'rejected' ? 'Document rejected' : null, label: 'Document' })),
    ...data.interviews.filter((interview) => inScope(interview.case_id)).map((interview) => ({ id: `interview-${interview.id}`, caseId: interview.case_id, at: interview.created_at, type: 'people', icon: 'ti-message-2', title: 'Exit interview submitted', label: 'Interview' })),
    ...data.cases.filter((exitCase) => inScope(exitCase.id) && exitCase.created_at).map((exitCase) => ({ id: `case-${exitCase.id}`, caseId: exitCase.id, at: exitCase.created_at, type: 'people', icon: 'ti-door-exit', title: 'Exit case opened', label: 'Case' })),
    ...data.cases.filter((exitCase) => inScope(exitCase.id) && exitCase.issued_at).map((exitCase) => ({ id: `letter-${exitCase.id}`, caseId: exitCase.id, at: exitCase.issued_at, type: 'people', icon: 'ti-file-certificate', title: 'Relieving letter issued', label: 'Letter' })),
  ].filter((event) => event.at && casesById[event.caseId]).sort((a, b) => new Date(b.at) - new Date(a.at))
}

function ActivityList({ events, casesById, linkCases = false }) {
  if (!events.length) return <EmptyState icon="ti-history" title="No activity yet" body="Timestamped case activity will appear here." />
  return <div className="hr-activity-list">{events.map((event) => {
    const exitCase = casesById[event.caseId]
    const title = linkCases ? `${event.title} for ${exitCase.employee_name}` : event.title
    const content = <><span className="hr-activity-icon"><i className={`ti ${event.icon}`} /></span><span className="hr-activity-copy"><strong>{title}</strong>{event.detail && <small>{event.detail}</small>}</span><time>{formatDateTime(event.at)}</time></>
    return linkCases ? <Link to={`/hr/exits/${event.caseId}?tab=audit`} className="hr-activity" key={event.id}>{content}</Link> : <div className="hr-activity" key={event.id}>{content}</div>
  })}</div>
}

export function Dashboard() {
  const data = useOutletContext()
  const { cases, tasks, runs, userId, reload } = data
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)
  const [actioning, issue] = useIssueRelievingLetter(userId, reload)
  const active = cases.filter((exitCase) => exitCase.status !== 'completed')
  const attention = attentionItems(cases, tasks)
  const leavingWeek = active.filter((exitCase) => { const days = dayDiff(exitCase.last_working_day); return days >= 0 && days <= 7 })
  const openEscalations = tasks.filter(isOpenEscalation)
  const ready = cases.filter((exitCase) => readyForRelievingLetter(exitCase, tasks))
  const pipeline = STAGES.map((stage) => ({ stage, count: active.filter((exitCase) => currentStage(exitCase, tasks) === stage).length }))
  const leavingSoon = active.filter((exitCase) => dayDiff(exitCase.last_working_day) >= 0).sort((a, b) => new Date(a.last_working_day) - new Date(b.last_working_day)).slice(0, 7)
  const casesById = Object.fromEntries(cases.map((exitCase) => [exitCase.id, exitCase]))
  const recent = activityEvents(data).slice(0, 8)

  async function confirmIssue() {
    const result = await issue(confirm.exitCase.id)
    setConfirm(null)
    setToast({ tone: result.ok ? 'success' : 'danger', message: result.message })
  }

  return <main className="hr-page" data-testid="hr-overview">
    <PageHeader title="Overview" description={`${active.length} active exits · ${attention.length} need your attention`} />

    <section className="hr-panel hr-attention">
      <div className="hr-panel-heading"><div><p className="hr-eyebrow">Priority queue</p><h2>Needs your attention</h2></div><Link to="/hr/exits?view=needs-attention">See all</Link></div>
      {attention.length ? <div className="hr-attention-list">{attention.slice(0, 5).map((item) => <article className="hr-attention-row" key={`${item.kind}-${item.case.id}`}>
        <StatusBadge tone={item.tone}>{item.kind}</StatusBadge>
        <div><Link to={`/hr/exits/${item.case.id}`}>{item.case.employee_name}</Link><p>{item.reason}</p></div>
        <span className="hr-age">{item.age || ''}</span>
        {item.issue ? <button type="button" className="hr-button" onClick={() => setConfirm({ exitCase: item.case, title: 'Issue relieving letter?', body: `Issue the relieving letter for ${item.case.employee_name} and close this case?`, confirmLabel: 'Issue letter', icon: 'ti-file-certificate' })}>Issue letter</button> : <Link className="hr-button" to={item.href}>{item.action}</Link>}
      </article>)}</div> : <EmptyState icon="ti-circle-check" title="You're all caught up." body="There are no cases requiring immediate action." />}
    </section>

    <section className="hr-kpi-grid" aria-label="Exit metrics">
      {[
        ['Active exits', active.length, '/hr/exits?view=active', 'ti-users'],
        ['Leaving in next 7 days', leavingWeek.length, '/hr/exits?view=leaving-this-week', 'ti-calendar-event'],
        ['Open escalations', openEscalations.length, '/hr/exits?view=escalated', 'ti-alert-triangle'],
        ['Ready for relieving letter', ready.length, '/hr/exits?view=ready', 'ti-file-certificate'],
        ['High risk', cases.filter((exitCase) => exitCase.risk_level === 'high').length, '/hr/risk-and-rehire?risk=high', 'ti-shield-exclamation'],
      ].map(([label, value, href, icon]) => <Link to={href} className="hr-kpi" key={label}><i className={`ti ${icon}`} /><span>{label}</span><strong>{value}</strong><i className="ti ti-chevron-right" /></Link>)}
    </section>

    <section className="hr-panel">
      <div className="hr-panel-heading"><div><p className="hr-eyebrow">Live workload</p><h2>Pipeline</h2></div><span>{active.length} active cases</span></div>
      <div className="hr-pipeline">{pipeline.map((item) => <Link key={item.stage} to={`/hr/exits?stage=${item.stage}`} className="hr-pipeline-stage"><span>{STAGE_LABEL[item.stage]}</span><strong>{item.count}</strong><div><span style={{ width: active.length ? `${Math.max(6, (item.count / active.length) * 100)}%` : '0%' }} /></div></Link>)}</div>
    </section>

    <div className="hr-overview-grid">
      <section className="hr-panel">
        <div className="hr-panel-heading"><div><p className="hr-eyebrow">Calendar</p><h2>Leaving soon</h2></div></div>
        {leavingSoon.length ? <div className="hr-compact-list">{leavingSoon.map((exitCase) => <Link to={`/hr/exits/${exitCase.id}`} key={exitCase.id}><span className="hr-avatar">{exitCase.employee_name?.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{exitCase.employee_name}</strong><small>{exitCase.department}</small></span><span>{STAGE_LABEL[currentStage(exitCase, tasks)]}</span><time>{formatDate(exitCase.last_working_day)}</time></Link>)}</div> : <EmptyState title="No upcoming last working days" />}
      </section>
      <section className="hr-panel">
        <div className="hr-panel-heading"><div><p className="hr-eyebrow">Latest changes</p><h2>Recent activity</h2></div></div>
        <ActivityList events={recent} casesById={casesById} linkCases />
      </section>
    </div>
    <ConfirmDialog config={confirm} busy={confirm ? actioning[confirm.exitCase.id] : false} onCancel={() => setConfirm(null)} onConfirm={confirmIssue} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </main>
}

const SAVED_VIEWS = [
  ['all', 'All'], ['needs-attention', 'Needs attention'], ['leaving-this-week', 'Leaving this week'],
  ['high-risk', 'High risk'], ['blocked', 'Blocked'], ['completed', 'Completed'],
]

export function AllExits() {
  const { cases, tasks } = useOutletContext()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState({ key: 'lastDay', direction: 'asc' })
  const [page, setPage] = useState(1)
  const view = params.get('view') || 'all'
  const stage = params.get('stage') || 'all'
  const risk = params.get('risk') || 'all'
  const attentionIds = new Set(attentionItems(cases, tasks).map((item) => item.case.id))
  const blockedIds = new Set(cases.filter((exitCase) => blockedReason(exitCase, tasks)).map((exitCase) => exitCase.id))
  const departments = [...new Set(cases.map((exitCase) => exitCase.department).filter(Boolean))].sort()

  const matchesView = (exitCase, selected) => {
    const days = dayDiff(exitCase.last_working_day)
    if (selected === 'needs-attention') return attentionIds.has(exitCase.id)
    if (selected === 'leaving-this-week') return exitCase.status !== 'completed' && days >= 0 && days <= 7
    if (selected === 'high-risk') return exitCase.risk_level === 'high'
    if (selected === 'blocked') return blockedIds.has(exitCase.id)
    if (selected === 'completed') return exitCase.status === 'completed'
    if (selected === 'active') return exitCase.status !== 'completed'
    if (selected === 'escalated') return tasksForCase(exitCase.id, tasks).some(isOpenEscalation)
    if (selected === 'ready') return readyForRelievingLetter(exitCase, tasks)
    return true
  }
  const viewCounts = Object.fromEntries(SAVED_VIEWS.map(([key]) => [key, cases.filter((exitCase) => matchesView(exitCase, key)).length]))
  const filtered = useMemo(() => cases.filter((exitCase) => {
    const caseStatusValue = caseStatus(exitCase, tasks).key
    return matchesView(exitCase, view) &&
      (stage === 'all' || currentStage(exitCase, tasks) === stage) &&
      (risk === 'all' || exitCase.risk_level === risk) &&
      (department === 'all' || exitCase.department === department) &&
      (status === 'all' || caseStatusValue === status || exitCase.status === status) &&
      (!search.trim() || exitCase.employee_name?.toLowerCase().includes(search.trim().toLowerCase()))
  }).sort((a, b) => {
    let left
    let right
    if (sort.key === 'employee') { left = a.employee_name || ''; right = b.employee_name || '' }
    else if (sort.key === 'stage') { left = STAGES.indexOf(currentStage(a, tasks)); right = STAGES.indexOf(currentStage(b, tasks)) }
    else if (sort.key === 'status') { left = caseStatus(a, tasks).label; right = caseStatus(b, tasks).label }
    else { left = new Date(a.last_working_day); right = new Date(b.last_working_day) }
    const result = typeof left === 'string' ? left.localeCompare(right) : left - right
    return sort.direction === 'asc' ? result : -result
  }), [cases, tasks, view, stage, risk, department, status, search, sort])

  useEffect(() => { setPage(1) }, [view, stage, risk, department, status, search, sort])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const setView = (key) => { const next = new URLSearchParams(params); if (key === 'all') next.delete('view'); else next.set('view', key); setParams(next) }
  const setStage = (key) => { const next = new URLSearchParams(params); if (key === 'all') next.delete('stage'); else next.set('stage', key); setParams(next) }
  const setRisk = (key) => { const next = new URLSearchParams(params); if (key === 'all') next.delete('risk'); else next.set('risk', key); setParams(next) }
  const changeSort = (key) => setSort((current) => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' })
  const sortIcon = (key) => sort.key === key ? (sort.direction === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down') : 'ti-selector'
  const viewName = SAVED_VIEWS.find(([key]) => key === view)?.[1] || humanize(view)

  return <main className="hr-page" data-testid="hr-exits">
    <PageHeader title="Exits" description={`${filtered.length} ${viewName.toLowerCase()} case${filtered.length === 1 ? '' : 's'}`} />
    <section className="hr-panel hr-exits-panel">
      <div className="hr-saved-views" role="tablist" aria-label="Saved views">{SAVED_VIEWS.map(([key, label]) => <button type="button" role="tab" aria-selected={view === key} className={view === key ? 'is-active' : ''} onClick={() => setView(key)} key={key}>{label}<span>{viewCounts[key]}</span></button>)}</div>
      <div className="hr-filterbar">
        <label className="hr-filter-search"><i className="ti ti-search" /><span className="sr-only">Search by employee name</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee" /></label>
        <label><span>Stage</span><select value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">All stages</option>{STAGES.map((key) => <option value={key} key={key}>{STAGE_LABEL[key]}</option>)}</select></label>
        <label><span>Department</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">All departments</option>{departments.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="escalated">Escalated</option><option value="ready">Ready</option><option value="completed">Completed</option></select></label>
        <label><span>Risk</span><select value={risk} onChange={(event) => setRisk(event.target.value)}><option value="all">All risk levels</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      </div>
      <div className="hr-table-scroll">
        <div className="hr-table hr-exits-table" role="table">
          <div className="hr-table-head" role="row">
            {[['employee', 'Employee'], ['stage', 'Stage']].map(([key, label]) => <button type="button" role="columnheader" onClick={() => changeSort(key)} key={key}>{label}<i className={`ti ${sortIcon(key)}`} /></button>)}
            <span role="columnheader">Progress</span>
            <button type="button" role="columnheader" onClick={() => changeSort('status')}>Status<i className={`ti ${sortIcon('status')}`} /></button>
            <span role="columnheader">Risk</span>
            <button type="button" role="columnheader" onClick={() => changeSort('lastDay')}>Last working day<i className={`ti ${sortIcon('lastDay')}`} /></button>
            <span aria-hidden="true" />
          </div>
          {rows.map((exitCase) => {
            const caseProgress = progressForCase(exitCase, tasks)
            const state = caseStatus(exitCase, tasks)
            return <div className="hr-table-row" role="row" tabIndex="0" key={exitCase.id} onClick={() => navigate(`/hr/exits/${exitCase.id}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/hr/exits/${exitCase.id}`) } }}>
              <span role="cell" className="hr-employee-cell"><span className="hr-avatar">{exitCase.employee_name?.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{exitCase.employee_name}</strong><small>{exitCase.department}</small></span></span>
              <span role="cell">{STAGE_LABEL[currentStage(exitCase, tasks)]}</span>
              <span role="cell" className="hr-progress-cell"><span><i style={{ width: `${caseProgress.percent}%` }} /></span><small>{caseProgress.done}/{caseProgress.total} tasks</small></span>
              <span role="cell"><StatusBadge tone={state.tone}>{state.label}</StatusBadge></span>
              <span role="cell">{exitCase.risk_level && <span className={`hr-risk hr-risk--${exitCase.risk_level}`}><i />{humanize(exitCase.risk_level)}</span>}</span>
              <span role="cell"><strong>{formatDate(exitCase.last_working_day)}</strong><small>{daysLabel(exitCase.last_working_day)}</small></span>
              <span role="cell"><i className="ti ti-chevron-right" /></span>
            </div>
          })}
        </div>
      </div>
      {!rows.length && <EmptyState icon="ti-filter-off" title={`No ${viewName.toLowerCase()} cases`} body="Try another saved view or clear the filters." />}
      {filtered.length > PAGE_SIZE && <nav className="hr-pagination" aria-label="Exits pagination"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><i className="ti ti-chevron-left" />Previous</button><span>Page {page} of {pageCount}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>Next<i className="ti ti-chevron-right" /></button></nav>}
    </section>
  </main>
}

function CaseProgress({ exitCase, tasks }) {
  return <ol className="hr-case-progress">{stageStates(exitCase, tasks).map((stage) => <li key={stage.key} className={`is-${stage.state}`}><span>{stage.state === 'done' ? <i className="ti ti-check" /> : stage.state === 'blocked' ? <i className="ti ti-alert-triangle" /> : STAGES.indexOf(stage.key) + 1}</span><div><strong>{stage.label}</strong><small>{humanize(stage.state)}</small></div></li>)}</ol>
}

function CaseOverviewTab({ exitCase, tasks }) {
  const stages = stageStates(exitCase, tasks)
  const active = stages.find((stage) => ['current', 'blocked'].includes(stage.state))
  const reason = blockedReason(exitCase, tasks) || tasksForCase(exitCase.id, tasks).find(isOpenEscalation)?.reason
  const nextTask = tasksForCase(exitCase.id, tasks).filter((task) => !isEscalation(task) && task.status !== 'done').sort((a, b) => new Date(a.due_date || '9999-12-31') - new Date(b.due_date || '9999-12-31'))[0]
  return <div className="hr-case-overview">
    <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Exit progress</p><h2>Where this case stands</h2></div></div><CaseProgress exitCase={exitCase} tasks={tasks} /></section>
    <div className="hr-case-overview-grid">
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Current focus</p><h2>{reason ? 'Current blocker' : 'Next step'}</h2></div></div>{reason ? <div className="hr-blocker"><i className="ti ti-alert-triangle" /><p>{reason}</p></div> : active ? <div className="hr-next-step"><span className="hr-stage-icon"><i className="ti ti-arrow-right" /></span><div><strong>{nextTask?.title || `${active.label} is the next stage`}</strong><span>Owned by {STAGE_OWNER[active.key]}</span>{nextTask?.due_date && <small>Due {formatDate(nextTask.due_date)}</small>}</div></div> : <EmptyState title="No next step" />}</section>
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Schedule</p><h2>Key dates</h2></div></div><dl className="hr-key-values">{exitCase.created_at && <div><dt>Case opened</dt><dd>{formatDate(exitCase.created_at)}</dd></div>}<div><dt>Last working day</dt><dd>{formatDate(exitCase.last_working_day)}</dd></div>{exitCase.issued_at && <div><dt>Letter issued</dt><dd>{formatDate(exitCase.issued_at)}</dd></div>}</dl></section>
    </div>
  </div>
}

function CaseTasksTab({ exitCase, tasks }) {
  const rows = tasksForCase(exitCase.id, tasks)
  return <div className="hr-task-groups">{STAGES.slice(0, -1).map((stage) => {
    const group = rows.filter((task) => task.stage === stage)
    const done = group.filter((task) => task.status === 'done').length
    return <details className="hr-panel hr-task-group" open key={stage}><summary><span><i className="ti ti-chevron-right" />{STAGE_LABEL[stage]}</span><span>{done} of {group.length} done</span></summary>{group.length ? <div>{group.map((task) => {
      const escalation = isEscalation(task)
      const status = escalation && isOpenEscalation(task) ? { label: 'Escalated', tone: 'danger' } : task.status === 'done' ? { label: 'Done', tone: 'success' } : task.due_date && dayDiff(task.due_date) < 0 ? { label: 'Overdue', tone: 'danger' } : { label: 'Pending', tone: 'warning' }
      return <article className="hr-task-row" key={task.id}><span><strong>{task.title}</strong><small>Owner: {STAGE_OWNER[stage]}</small></span>{task.due_date && <time>Due {formatDate(task.due_date)}</time>}<StatusBadge tone={status.tone}>{status.label}</StatusBadge></article>
    })}</div> : <EmptyState title={`No ${STAGE_LABEL[stage]} tasks`} />}</details>
  })}</div>
}

function requiredDocuments(department) {
  return [...REQUIRED_DOCS_BASE, ...(REQUIRED_DOCS_EXTRA[department] ?? [])]
}

function documentState(document) {
  if (!document) return { label: 'Required', tone: 'neutral' }
  if (document.status === 'validated') return { label: 'Validated', tone: 'success' }
  if (document.status === 'rejected') return { label: 'Rejected', tone: 'danger' }
  return { label: 'Pending', tone: 'warning' }
}

function ocrReason(value) {
  if (!value) return ''
  const missing = value.match(/missing=\[(.*?)\]/)?.[1]?.trim()
  if (!missing) return value
  const items = missing.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  return items.length ? `Missing or unreadable: ${items.join(', ')}` : value
}

function CaseDocumentsTab({ exitCase, documents }) {
  const latest = {}
  documents.filter((document) => document.case_id === exitCase.id).forEach((document) => { if (!latest[document.doc_type]) latest[document.doc_type] = document })
  return <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Required files</p><h2>Documents</h2></div></div><div className="hr-document-list">{requiredDocuments(exitCase.department).map((type) => {
    const document = latest[type]
    const state = documentState(document)
    return <article key={type}><span className="hr-document-icon"><i className="ti ti-file-text" /></span><div><strong>{type}</strong>{document?.created_at && <small>Uploaded {formatDate(document.created_at)}</small>}{document?.status === 'rejected' && document.validation_detail && <p>{ocrReason(document.validation_detail)}</p>}</div><StatusBadge tone={state.tone}>{state.label}</StatusBadge></article>
  })}</div></section>
}

function InterviewAnswers({ interview }) {
  return <dl className="hr-key-values">
    <div><dt>Reason for leaving</dt><dd>{interview.reason_for_leaving || 'Not submitted yet'}</dd></div>
    <div><dt>Feedback</dt><dd>{interview.feedback || 'Not submitted yet'}</dd></div>
    <div><dt>Would recommend</dt><dd>{interview.would_recommend == null ? 'Not submitted yet' : interview.would_recommend ? 'Yes' : 'No'}</dd></div>
    <div><dt>Additional comments</dt><dd>{interview.comments || 'Not submitted yet'}</dd></div>
  </dl>
}

function CaseInterviewTab({ exitCase, interviews }) {
  const interview = interviews.find((item) => item.case_id === exitCase.id)
  if (!interview) return <section className="hr-panel"><EmptyState icon="ti-message-2" title="Exit interview not submitted" body="The employee has not submitted an exit interview yet." /></section>
  return <div className="hr-interview-grid">
    <section className="hr-panel hr-interview-summary"><div className="hr-panel-heading"><div><p className="hr-eyebrow">AI analysis</p><h2>Interview summary</h2></div><StatusBadge tone={SENTIMENT_TONE[interview.sentiment] || 'neutral'}>{interview.sentiment ? humanize(interview.sentiment) : 'Not assessed yet'}</StatusBadge></div><p>{interview.summary || 'Not assessed yet'}</p><div className="hr-interview-recommendation"><strong>Recommendations</strong><p>{interview.recommendations || 'Not assessed yet'}</p></div><div className="hr-interview-recommendation"><strong>Rehire reason</strong><p>{interview.rehire_reason || 'Not assessed yet'}</p></div></section>
    <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Signals</p><h2>Key themes</h2></div></div>{interview.themes?.length ? <div className="hr-theme-list">{interview.themes.map((theme) => <span key={theme}>{theme}</span>)}</div> : <p className="hr-muted-copy">No data yet</p>}</section>
    <section className="hr-panel hr-interview-answers"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Original submission</p><h2>Employee answers</h2></div></div><InterviewAnswers interview={interview} /></section>
  </div>
}

function complianceItems(exitCase, tasks, documents, approvedCaseIds) {
  const rows = tasksForCase(exitCase.id, tasks).filter((task) => task.stage !== 'compliance')
  const docs = documents.filter((document) => document.case_id === exitCase.id && document.status === 'validated')
  const findTask = (pattern) => rows.find((task) => pattern.test(task.title || ''))
  const check = (label, taskPattern, docType) => {
    const document = docType && docs.find((item) => item.doc_type === docType)
    const task = findTask(taskPattern)
    const passed = Boolean(document || task?.status === 'done')
    return { label, passed, evidence: document ? `${document.doc_type} validated` : task?.title }
  }
  return [
    check('NDA', /\bNDA\b/i, 'NDA'),
    check('Asset return', /asset return|return.*asset|collect.*laptop/i, 'Asset Return Form'),
    check('Access revoked', /access revoked|revoke.*access|deprovision/i),
    { label: 'Manager approval', passed: approvedCaseIds.has(exitCase.id), evidence: approvedCaseIds.has(exitCase.id) ? 'Manager approval recorded' : '' },
  ]
}

function CaseRiskTab({ exitCase, tasks, documents, approvedCaseIds, interviews, complianceChecks }) {
  const recorded = (complianceChecks || []).filter((item) => item.case_id === exitCase.id)
  const checks = recorded.length ? [...new Map(recorded.map((item) => [item.item, item])).values()].map((item) => ({
    label: humanize(item.item), passed: item.status === 'done', evidence: item.evidence || item.failure_reason || 'No data yet', status: item.status,
  })) : complianceItems(exitCase, tasks, documents, approvedCaseIds).map((item) => ({ ...item, status: item.passed ? 'done' : 'not_assessed' }))
  const interview = interviews.find((item) => item.case_id === exitCase.id)
  const hasAssessment = exitCase.risk_level || exitCase.risk_score != null || exitCase.rehire_eligible != null
  return <div className="hr-risk-grid">
    <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Assessment</p><h2>Risk and rehire</h2></div></div>{hasAssessment ? <dl className="hr-risk-summary"><div><dt>Risk level</dt><dd>{exitCase.risk_level ? <StatusBadge tone={RISK_TONE[exitCase.risk_level] || 'neutral'}>{humanize(exitCase.risk_level)}</StatusBadge> : 'Not assessed yet'}</dd></div><div><dt>Risk score</dt><dd>{riskScore(exitCase.risk_score)}</dd></div><div><dt>Rehire eligibility</dt><dd>{exitCase.rehire_eligible == null ? 'Not assessed yet' : exitCase.rehire_eligible ? 'Eligible' : 'Not eligible'}</dd></div><div><dt>Rehire reason</dt><dd>{interview?.rehire_reason || 'Not assessed yet'}</dd></div></dl> : <EmptyState icon="ti-shield" title="Not assessed yet" body="Risk and rehire results will appear after assessment." />}</section>
    <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Required checks</p><h2>Compliance checklist</h2></div><span>{checks.filter((item) => item.passed).length} of {checks.length} passed</span></div>{checks.length ? <div className="hr-compliance-list">{checks.map((item) => <article key={item.label}><i className={`ti ${item.passed ? 'ti-circle-check' : item.status === 'not_assessed' ? 'ti-circle-dashed' : 'ti-circle-x'}`} /><div><strong>{item.label}</strong><small>{item.evidence || 'No data yet'}</small></div><StatusBadge tone={item.passed ? 'success' : item.status === 'not_assessed' ? 'neutral' : 'danger'}>{item.passed ? 'Pass' : item.status === 'not_assessed' ? 'Not assessed yet' : humanize(item.status)}</StatusBadge></article>)}</div> : <EmptyState title="No data yet" body="Compliance checks have not run for this case." />}</section>
  </div>
}

function CaseAuditTab({ data, exitCase }) {
  const [filter, setFilter] = useState('all')
  const events = activityEvents(data, exitCase.id).filter((event) => filter === 'all' || event.type === filter)
  return <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Recorded history</p><h2>Audit trail</h2></div><div className="hr-segmented" role="group" aria-label="Audit trail filter">{[['all', 'All'], ['agent', 'Agents'], ['people', 'People']].map(([key, label]) => <button type="button" className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)} key={key}>{label}</button>)}</div></div><ActivityList events={events} casesById={{ [exitCase.id]: exitCase }} /></section>
}

export function CasePage() {
  const data = useOutletContext()
  const { caseId } = useParams()
  const [params, setParams] = useSearchParams()
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)
  const [actioning, issue] = useIssueRelievingLetter(data.userId, data.reload)
  const exitCase = data.cases.find((item) => item.id === caseId)
  if (!exitCase) return <main className="hr-page"><Link className="hr-back-link" to="/hr/exits"><i className="ti ti-arrow-left" />Back to Exits</Link><section className="hr-panel"><EmptyState title="Case not found" body="This case may have been removed or is no longer available." /></section></main>
  const activeTab = CASE_TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'overview'
  const state = caseStatus(exitCase, data.tasks)
  const manager = data.staff.find((person) => person.id === exitCase.manager_id)
  const escalation = tasksForCase(exitCase.id, data.tasks).find(isOpenEscalation)
  const action = state.key === 'ready'
    ? <button type="button" className="hr-button hr-button--primary" onClick={() => setConfirm({ exitCase, title: 'Issue relieving letter?', body: `Issue the relieving letter for ${exitCase.employee_name} and close this case?`, confirmLabel: 'Issue letter', icon: 'ti-file-certificate' })}>Issue relieving letter</button>
    : state.key === 'escalated' && escalation
      ? <Link className="hr-button hr-button--primary" to={`/hr/escalations#${escalation.id}`}>Review escalation</Link>
      : null
  async function confirmIssue() { const result = await issue(exitCase.id); setConfirm(null); setToast({ tone: result.ok ? 'success' : 'danger', message: result.message }) }
  return <main className="hr-page" data-testid="hr-case-page">
    <Link className="hr-back-link" to="/hr/exits"><i className="ti ti-arrow-left" />Back to Exits</Link>
    <header className="hr-case-header"><div><div className="hr-case-title"><h1>{exitCase.employee_name}</h1><StatusBadge tone={state.tone}>{state.label}</StatusBadge></div><p>{[exitCase.role_title, exitCase.department, manager?.full_name ? `Manager: ${manager.full_name}` : null].filter(Boolean).join(' · ')}</p><span><i className="ti ti-calendar-event" />Last working day <strong>{formatDate(exitCase.last_working_day)}</strong>{daysLabel(exitCase.last_working_day) && ` · ${daysLabel(exitCase.last_working_day)}`}</span></div>{action}</header>
    <nav className="hr-case-tabs" aria-label="Case sections">{CASE_TABS.map(([key, label]) => <button type="button" className={activeTab === key ? 'is-active' : ''} onClick={() => setParams(key === 'overview' ? {} : { tab: key })} key={key}>{label}</button>)}</nav>
    {activeTab === 'overview' && <CaseOverviewTab exitCase={exitCase} tasks={data.tasks} />}
    {activeTab === 'tasks' && <CaseTasksTab exitCase={exitCase} tasks={data.tasks} />}
    {activeTab === 'documents' && <CaseDocumentsTab exitCase={exitCase} documents={data.documents} />}
    {activeTab === 'interview' && <CaseInterviewTab exitCase={exitCase} interviews={data.interviews} />}
    {activeTab === 'risk' && <CaseRiskTab exitCase={exitCase} tasks={data.tasks} documents={data.documents} approvedCaseIds={data.approvedCaseIds} interviews={data.interviews} complianceChecks={data.complianceChecks} />}
    {activeTab === 'audit' && <CaseAuditTab data={data} exitCase={exitCase} />}
    <ConfirmDialog config={confirm} busy={actioning[exitCase.id]} onCancel={() => setConfirm(null)} onConfirm={confirmIssue} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </main>
}

export function RiskAndRehire() {
  const { cases, tasks, interviews } = useOutletContext()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [department, setDepartment] = useState('all')
  const risk = params.get('risk') || 'all'
  const rehire = params.get('rehire') || 'all'
  const departments = [...new Set(cases.map((item) => item.department).filter(Boolean))].sort()
  const interviewsByCase = Object.fromEntries(interviews.map((item) => [item.case_id, item]))
  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete(key); else next.set(key, value)
    setParams(next)
  }
  const rehireKey = (exitCase) => exitCase.rehire_eligible == null ? 'not_assessed' : exitCase.rehire_eligible ? 'eligible' : 'not_eligible'
  const filtered = [...cases].filter((exitCase) =>
    (risk === 'all' || (risk === 'not_assessed' ? !exitCase.risk_level : exitCase.risk_level === risk)) &&
    (rehire === 'all' || rehireKey(exitCase) === rehire) &&
    (department === 'all' || exitCase.department === department)
  ).sort((a, b) => (b.risk_score ?? -1) - (a.risk_score ?? -1) || a.employee_name.localeCompare(b.employee_name))
  const tiles = [
    ['High risk', cases.filter((item) => item.risk_level === 'high').length, 'risk', 'high', 'danger'],
    ['Medium risk', cases.filter((item) => item.risk_level === 'medium').length, 'risk', 'medium', 'warning'],
    ['Low risk', cases.filter((item) => item.risk_level === 'low').length, 'risk', 'low', 'success'],
    ['Rehire eligible', cases.filter((item) => item.rehire_eligible === true).length, 'rehire', 'eligible', 'success'],
    ['Not eligible', cases.filter((item) => item.rehire_eligible === false).length, 'rehire', 'not_eligible', 'danger'],
  ]
  return <main className="hr-page" data-testid="hr-risk-rehire">
    <PageHeader title="Risk & rehire" description={`${filtered.length} case${filtered.length === 1 ? '' : 's'} · highest risk first`} />
    <section className="hr-metric-tiles" aria-label="Risk and rehire filters">{tiles.map(([label, count, key, value, tone]) => <button type="button" className={`is-${tone} ${params.get(key) === value ? 'is-active' : ''}`} onClick={() => setParam(key, params.get(key) === value ? 'all' : value)} key={label}><span>{label}</span><strong>{count}</strong></button>)}</section>
    <section className="hr-panel">
      <div className="hr-filterbar hr-risk-filters">
        <label><span>Risk level</span><select value={risk} onChange={(event) => setParam('risk', event.target.value)}><option value="all">All risk levels</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="not_assessed">Not assessed yet</option></select></label>
        <label><span>Rehire status</span><select value={rehire} onChange={(event) => setParam('rehire', event.target.value)}><option value="all">All rehire statuses</option><option value="eligible">Eligible</option><option value="not_eligible">Not eligible</option><option value="not_assessed">Not assessed</option></select></label>
        <label><span>Department</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">All departments</option>{departments.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      </div>
      <div className="hr-table-scroll"><div className="hr-table hr-risk-table" role="table">
        <div className="hr-table-head" role="row"><span>Employee</span><span>Risk level</span><span>Risk score</span><span>Rehire</span><span>Rehire reason</span><span>Stage</span><span>Last working day</span></div>
        {filtered.map((exitCase) => <div className="hr-table-row" role="row" tabIndex="0" key={exitCase.id} onClick={() => navigate(`/hr/exits/${exitCase.id}?tab=risk`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate(`/hr/exits/${exitCase.id}?tab=risk`) }}>
          <span className="hr-employee-cell"><span className="hr-avatar">{exitCase.employee_name?.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{exitCase.employee_name}</strong><small>{exitCase.department}</small></span></span>
          <span>{exitCase.risk_level ? <StatusBadge tone={RISK_TONE[exitCase.risk_level]}>{humanize(exitCase.risk_level)}</StatusBadge> : 'Not assessed yet'}</span>
          <span><strong>{riskScore(exitCase.risk_score)}</strong></span>
          <span>{exitCase.rehire_eligible == null ? 'Not assessed' : exitCase.rehire_eligible ? 'Eligible' : 'Not eligible'}</span>
          <span title={interviewsByCase[exitCase.id]?.rehire_reason || ''}>{interviewsByCase[exitCase.id]?.rehire_reason || 'Not assessed yet'}</span>
          <span>{STAGE_LABEL[currentStage(exitCase, tasks)]}</span>
          <span>{formatDate(exitCase.last_working_day)}</span>
        </div>)}
      </div></div>
      {!filtered.length && <EmptyState icon="ti-filter-off" title="No matching cases" body="Try clearing one of the filters." />}
    </section>
  </main>
}

export function ExitInterviews() {
  const { cases, interviews } = useOutletContext()
  const [tab, setTab] = useState('submitted')
  const [sentiment, setSentiment] = useState('all')
  const [department, setDepartment] = useState('all')
  const [theme, setTheme] = useState('all')
  const [selected, setSelected] = useState(null)
  const casesById = Object.fromEntries(cases.map((item) => [item.id, item]))
  const submittedIds = new Set(interviews.map((item) => item.case_id))
  const departments = [...new Set(cases.map((item) => item.department).filter(Boolean))].sort()
  const themes = [...new Set(interviews.flatMap((item) => item.themes || []))].sort()
  const themeCounts = {}
  interviews.forEach((item) => (item.themes || []).forEach((value) => { themeCounts[value] = (themeCounts[value] || 0) + 1 }))
  const topThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
  const sentimentCounts = Object.fromEntries(['positive', 'neutral', 'negative'].map((value) => [value, interviews.filter((item) => item.sentiment === value).length]))
  const submitted = interviews.filter((item) => {
    const exitCase = casesById[item.case_id]
    return exitCase && (sentiment === 'all' || item.sentiment === sentiment) && (department === 'all' || exitCase.department === department) && (theme === 'all' || item.themes?.includes(theme))
  })
  const pending = cases.filter((item) => !submittedIds.has(item.id)).sort((a, b) => new Date(a.last_working_day) - new Date(b.last_working_day))
  useEffect(() => {
    if (!selected) return undefined
    const close = (event) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selected])
  const selectedCase = selected ? casesById[selected.case_id] : null
  return <main className="hr-page" data-testid="hr-exit-interviews">
    <PageHeader title="Exit interviews" description={`${interviews.length} submitted · ${pending.length} not submitted yet`} />
    <div className="hr-interview-insights">
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">AI analysis</p><h2>Sentiment split</h2></div></div><div className="hr-sentiment-split">{['positive', 'neutral', 'negative'].map((value) => <span key={value}><i className={`is-${value}`} /><span>{humanize(value)}</span><strong>{sentimentCounts[value]}</strong></span>)}</div></section>
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Recurring signals</p><h2>Top themes</h2></div></div>{topThemes.length ? <div className="hr-theme-counts">{topThemes.map(([value, count]) => <span key={value}>{value}<strong>{count}</strong></span>)}</div> : <EmptyState title="No data yet" />}</section>
    </div>
    <section className="hr-panel"><div className="hr-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'submitted'} className={tab === 'submitted' ? 'is-active' : ''} onClick={() => setTab('submitted')}>Submitted <span>{interviews.length}</span></button><button type="button" role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'is-active' : ''} onClick={() => setTab('pending')}>Not submitted yet <span>{pending.length}</span></button></div>
      {tab === 'submitted' ? <><div className="hr-filterbar hr-interview-filters"><label><span>Sentiment</span><select value={sentiment} onChange={(event) => setSentiment(event.target.value)}><option value="all">All sentiments</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></label><label><span>Department</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">All departments</option>{departments.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label><span>Theme</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="all">All themes</option>{themes.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div><div className="hr-interview-list">{submitted.map((item) => { const exitCase = casesById[item.case_id]; return <button type="button" onClick={() => setSelected(item)} key={item.id}><span className="hr-employee-cell"><span className="hr-avatar">{exitCase.employee_name?.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{exitCase.employee_name}</strong><small>{exitCase.department}</small></span></span><time>{formatDate(item.created_at)}</time><span><StatusBadge tone={SENTIMENT_TONE[item.sentiment] || 'neutral'}>{item.sentiment ? humanize(item.sentiment) : 'Not assessed yet'}</StatusBadge></span><span className="hr-theme-list">{item.themes?.length ? item.themes.slice(0, 3).map((value) => <span key={value}>{value}</span>) : 'No data yet'}</span><span>{item.summary || 'Not assessed yet'}</span><i className="ti ti-chevron-right" /></button> })}</div>{!submitted.length && <EmptyState title="No matching submitted interviews" />}</> : <div className="hr-pending-interviews">{pending.map((exitCase) => { const days = dayDiff(exitCase.last_working_day); return <Link to={`/hr/exits/${exitCase.id}?tab=interview`} key={exitCase.id}><span className="hr-employee-cell"><span className="hr-avatar">{exitCase.employee_name?.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{exitCase.employee_name}</strong><small>{exitCase.department}</small></span></span><time>{formatDate(exitCase.last_working_day)}</time><strong>{days == null ? 'No data yet' : days < 0 ? `${Math.abs(days)} days past` : `${days} days left`}</strong><i className="ti ti-chevron-right" /></Link> })}</div>}
    </section>
    {selected && <div className="hr-agent-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><aside className="hr-agent-drawer hr-interview-drawer" role="dialog" aria-modal="true" aria-labelledby="interview-drawer-title"><header><div><p className="hr-eyebrow">Exit interview review</p><h2 id="interview-drawer-title">{selectedCase?.employee_name}</h2><p>{selectedCase?.department}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Close"><i className="ti ti-x" /></button></header><dl><div><dt>Submitted</dt><dd>{formatDate(selected.created_at)}</dd></div><div><dt>Sentiment</dt><dd>{selected.sentiment ? humanize(selected.sentiment) : 'Not assessed yet'}</dd></div></dl><h3>Full AI summary</h3><p>{selected.summary || 'Not assessed yet'}</p><h3>Themes</h3>{selected.themes?.length ? <div className="hr-theme-list">{selected.themes.map((value) => <span key={value}>{value}</span>)}</div> : <p>No data yet</p>}<h3>Recommendations</h3><p>{selected.recommendations || 'Not assessed yet'}</p><h3>Rehire reason</h3><p>{selected.rehire_reason || 'Not assessed yet'}</p><h3>Original answers</h3><InterviewAnswers interview={selected} /><Link className="hr-button hr-button--primary" to={`/hr/exits/${selected.case_id}?tab=interview`}>Open case</Link></aside></div>}
  </main>
}

const AUDIT_CHECKS = [
  ['sla_breach', 'SLA breach'], ['missing_approval', 'Missing approval'], ['skipped_step', 'Skipped step'],
]

export function Insights() {
  const { cases, tasks, interviews, alerts, insight, audit, optimization } = useOutletContext()
  const active = cases.filter((item) => item.status !== 'completed')
  const assessed = cases.filter((item) => item.risk_level)
  const completion = tasks.length ? Math.round((tasks.filter((item) => item.status === 'done').length / tasks.length) * 100) : null
  const departments = Object.entries(cases.reduce((counts, item) => ({ ...counts, [item.department || 'No data yet']: (counts[item.department || 'No data yet'] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])
  const pendingTasks = tasks.filter((item) => item.status !== 'done' && !(isEscalation(item) && ['rerouted', 'resolved'].includes(item.escalation_state)))
  const bottlenecks = STAGES.slice(0, -1).map((stage) => [stage, pendingTasks.filter((item) => item.stage === stage).length]).sort((a, b) => b[1] - a[1])
  const riskCounts = Object.fromEntries(['high', 'medium', 'low'].map((value) => [value, cases.filter((item) => item.risk_level === value).length]))
  const sentimentCounts = Object.fromEntries(['positive', 'neutral', 'negative'].map((value) => [value, interviews.filter((item) => item.sentiment === value).length]))
  const themeCounts = {}
  interviews.forEach((item) => (item.themes || []).forEach((value) => { themeCounts[value] = (themeCounts[value] || 0) + 1 }))
  const topThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
  const auditStats = audit?.stats || null
  const maxDepartment = Math.max(1, ...departments.map(([, count]) => count))
  const maxBottleneck = Math.max(1, ...bottlenecks.map(([, count]) => count))
  return <main className="hr-page" data-testid="hr-insights">
    <PageHeader title="Insights" description="Exit trends, workflow health, risk signals, and policy audit results." />
    <section className="hr-insight-kpis">{[['Total exits', cases.length], ['Active exits', active.length], ['Task completion', completion == null ? 'No data yet' : `${completion}%`], ['High risk', riskCounts.high]].map(([label, value]) => <article className={typeof value === 'string' && value.startsWith('No ') ? 'is-empty' : ''} key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <div className="hr-insights-grid">
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Workforce</p><h2>Exits by department</h2></div></div>{departments.length ? <div className="hr-bars">{departments.map(([label, count]) => <div key={label}><span><span>{label}</span><strong>{count}</strong></span><div><i style={{ width: `${(count / maxDepartment) * 100}%` }} /></div></div>)}</div> : <EmptyState title="No data yet" />}</section>
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Workflow</p><h2>Stage bottlenecks</h2></div></div><p className="hr-data-note"><i className="ti ti-info-circle" />Pending work by stage. Re-routed and resolved escalation markers are excluded.</p><div className="hr-bars">{bottlenecks.map(([stage, count], index) => <div className={index === 0 && count ? 'is-longest' : ''} key={stage}><span><span>{STAGE_LABEL[stage]}</span><strong>{count}</strong></span><div><i style={{ width: `${(count / maxBottleneck) * 100}%` }} /></div></div>)}</div>{optimization?.created_at && <small className="hr-generated">Latest workflow analysis: {formatDateTime(optimization.created_at)}</small>}</section>
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Assessment</p><h2>Risk overview</h2></div><span>{assessed.length} assessed</span></div><div className="hr-risk-overview">{['high', 'medium', 'low'].map((value) => <Link className={`is-${value}`} to={`/hr/risk-and-rehire?risk=${value}`} key={value}><span><i />{humanize(value)} risk</span><strong>{riskCounts[value]}</strong><small>View cases <i className="ti ti-arrow-right" /></small></Link>)}</div></section>
      <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Alerts</p><h2>Trend alerts</h2></div></div>{alerts.length ? <div className="hr-trend-list">{alerts.slice(0, 6).map((item) => <article key={item.id}><div><strong>{item.theme}</strong><span>{item.department || 'All departments'}</span></div><StatusBadge tone={RISK_TONE[item.severity] || 'neutral'}>{humanize(item.severity)}</StatusBadge><p>{item.detail || 'No data yet'}</p><time>{formatDateTime(item.created_at)}</time></article>)}</div> : <EmptyState title="No data yet" body="No trend alerts have been raised." />}</section>
      <section className="hr-panel hr-insight-interviews"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Exit interviews</p><h2>Themes and sentiment</h2></div><Link to="/hr/exit-interviews">Review interviews</Link></div><div className="hr-interview-insights"><div><h3>Sentiment split</h3><div className="hr-sentiment-split">{['positive', 'neutral', 'negative'].map((value) => <span key={value}><i className={`is-${value}`} /><span>{humanize(value)}</span><strong>{sentimentCounts[value]}</strong></span>)}</div></div><div><h3>Top themes</h3>{topThemes.length ? <div className="hr-theme-counts">{topThemes.map(([value, count]) => <span key={value}>{value}<strong>{count}</strong></span>)}</div> : <p className="hr-muted-copy">No data yet</p>}</div></div></section>
      <section className="hr-panel hr-insight-audit"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Policy compliance</p><h2>Audit report</h2></div><time>{audit?.created_at ? formatDateTime(audit.created_at) : 'Not run yet'}</time></div><div className="hr-audit-summary"><span>Cases audited<strong>{auditStats?.cases_audited ?? 'Not assessed yet'}</strong></span><span>Breaches found<strong>{auditStats?.breach_count ?? 'Not assessed yet'}</strong></span></div><div className="hr-audit-checks">{AUDIT_CHECKS.map(([key, label]) => <div key={key}><span>{label}</span><strong>{auditStats?.breaches_by_check?.[key] ?? 'Not assessed yet'}</strong></div>)}</div><div className="hr-recommendation-copy"><strong>Recommendation</strong><p>{audit?.narrative || 'Not assessed yet'}</p></div></section>
      <section className="hr-panel hr-latest-insight"><div className="hr-insight-summary"><i className="ti ti-sparkles" /><div><p className="hr-eyebrow">Latest AI insight</p><p>{insight?.narrative || 'Not assessed yet'}</p>{insight?.created_at && <small className="hr-generated">Generated {formatDateTime(insight.created_at)}</small>}</div>{insight && <details><summary>View details</summary><pre>{JSON.stringify(insight.stats, null, 2)}</pre></details>}</div></section>
    </div>
  </main>
}

export function Escalations() {
  const { cases, tasks, profile, reload } = useOutletContext()
  const [view, setView] = useState('open')
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)
  const [acting, act] = useEscalationAction(reload)
  const casesById = Object.fromEntries(cases.map((exitCase) => [exitCase.id, exitCase]))
  const escalations = tasks.filter(isEscalation)
  const open = escalations.filter(isOpenEscalation).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const resolved = escalations.filter((task) => !isOpenEscalation(task)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const shown = view === 'open' ? open : resolved
  async function confirmAction() { const result = await act(confirm.task, confirm.action, profile?.full_name); setConfirm(null); setToast({ tone: result.ok ? 'success' : 'danger', message: result.message }) }
  return <main className="hr-page" data-testid="hr-escalations">
    <PageHeader title="Escalations" description="Review rejected manager handovers and decide the next step." />
    <section className="hr-panel"><div className="hr-tabs" role="tablist"><button type="button" role="tab" aria-selected={view === 'open'} className={view === 'open' ? 'is-active' : ''} onClick={() => setView('open')}>Open <span>{open.length}</span></button><button type="button" role="tab" aria-selected={view === 'resolved'} className={view === 'resolved' ? 'is-active' : ''} onClick={() => setView('resolved')}>Resolved <span>{resolved.length}</span></button></div>
      {shown.length ? <div className="hr-escalation-list">{shown.map((task) => { const exitCase = casesById[task.case_id]; const state = task.escalation_state ?? 'open'; return <article className="hr-escalation-card" id={task.id} key={task.id}><div className="hr-escalation-card__head"><div className="hr-employee-cell"><span className="hr-avatar">{exitCase?.employee_name?.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><Link to={`/hr/exits/${task.case_id}`}>{exitCase?.employee_name}</Link><small>{exitCase?.department}</small></span></div><StatusBadge tone={state === 'open' ? 'danger' : state === 'resolved' ? 'success' : 'info'}>{state === 'open' ? 'Open' : state === 'resolved' ? 'Resolved' : 'Re-routed'}</StatusBadge></div>{task.reason && <blockquote>“{task.reason}”</blockquote>}<div className="hr-escalation-card__meta"><span>Rejected by manager</span>{task.created_at && <span>{ageLabel(task.created_at)} old</span>}</div>{state === 'open' && <div className="hr-escalation-card__actions"><button type="button" className="hr-button" onClick={() => setConfirm({ task, action: 'rerouted', title: 'Re-route to manager?', body: `Send ${exitCase?.employee_name}'s case back to the manager for another review?`, confirmLabel: 'Re-route', icon: 'ti-route' })}>Re-route to manager</button><button type="button" className="hr-button" onClick={() => setConfirm({ task, action: 'resolved', title: 'Resolve escalation?', body: `Close the escalation for ${exitCase?.employee_name}?`, confirmLabel: 'Resolve', icon: 'ti-circle-check' })}>Resolve</button></div>}</article>})}</div> : <EmptyState icon="ti-circle-check" title={view === 'open' ? 'No open escalations.' : 'No resolved escalations.'} />}
    </section>
    <ConfirmDialog config={confirm} busy={confirm ? acting[confirm.task.id] : false} onCancel={() => setConfirm(null)} onConfirm={confirmAction} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </main>
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function downloadLetter(exitCase) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relieving letter</title><style>body{font:14px/1.6 system-ui;color:#17212b;padding:48px}.letter{max-width:680px;margin:auto}.date{color:#52606d}h1{font-size:24px}</style></head><body><main class="letter"><p>Perficient</p><h1>Relieving Letter</h1><p class="date">Issued ${escapeHtml(formatDate(exitCase.issued_at))}</p><p>This confirms that <strong>${escapeHtml(exitCase.employee_name)}</strong>, ${escapeHtml(exitCase.role_title)}, ${escapeHtml(exitCase.department)}, completed all exit formalities as of ${escapeHtml(formatDate(exitCase.last_working_day))}.</p><p>Regards,<br>Perficient HR</p></main></body></html>`
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `relieving-letter-${exitCase.employee_id || exitCase.employee_name.replace(/\s+/g, '-').toLowerCase()}.html`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function RelievingLetters() {
  const { cases, tasks, userId, reload } = useOutletContext()
  const [view, setView] = useState('ready')
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)
  const [actioning, issue] = useIssueRelievingLetter(userId, reload)
  const ready = cases.filter((exitCase) => readyForRelievingLetter(exitCase, tasks)).sort((a, b) => new Date(a.last_working_day) - new Date(b.last_working_day))
  const issued = cases.filter((exitCase) => exitCase.relieving_letter_issued).sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))
  const shown = view === 'ready' ? ready : issued
  async function confirmIssue() { const result = await issue(confirm.exitCase.id); setConfirm(null); setToast({ tone: result.ok ? 'success' : 'danger', message: result.message }) }
  return <main className="hr-page" data-testid="hr-relieving-letters"><PageHeader title="Relieving letters" description="Issue letters only after every required clearance is complete." /><section className="hr-panel"><div className="hr-tabs" role="tablist"><button type="button" role="tab" aria-selected={view === 'ready'} className={view === 'ready' ? 'is-active' : ''} onClick={() => setView('ready')}>Ready to issue <span>{ready.length}</span></button><button type="button" role="tab" aria-selected={view === 'issued'} className={view === 'issued' ? 'is-active' : ''} onClick={() => setView('issued')}>Issued <span>{issued.length}</span></button></div>{shown.length ? <div className="hr-letter-list">{shown.map((exitCase) => <article key={exitCase.id}><div className="hr-employee-cell"><span className="hr-avatar">{exitCase.employee_name?.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><Link to={`/hr/exits/${exitCase.id}`}>{exitCase.employee_name}</Link><small>{exitCase.department}</small></span></div><span>{view === 'ready' ? `Last day ${formatDate(exitCase.last_working_day)}` : `Issued ${formatDate(exitCase.issued_at)}`}</span>{view === 'ready' ? <button type="button" className="hr-button" onClick={() => setConfirm({ exitCase, title: 'Issue relieving letter?', body: `Issue the relieving letter for ${exitCase.employee_name} and close this case?`, confirmLabel: 'Issue letter', icon: 'ti-file-certificate' })}>Issue letter</button> : <button type="button" className="hr-button" onClick={() => downloadLetter(exitCase)}><i className="ti ti-download" />Download</button>}</article>)}</div> : <EmptyState icon="ti-file-certificate" title={view === 'ready' ? 'No letters ready to issue.' : 'No letters issued yet.'} />}</section><ConfirmDialog config={confirm} busy={confirm ? actioning[confirm.exitCase.id] : false} onCancel={() => setConfirm(null)} onConfirm={confirmIssue} /><Toast toast={toast} onClose={() => setToast(null)} /></main>
}

const AGENT_CATALOG = [
  { key: 'manager_agent', name: 'Manager Agent', group: 'Clearance', trigger: 'On approval', description: 'Records the manager decision point for knowledge-transfer approval or rejection.' },
  { key: 'hr_agent', name: 'HR Agent', group: 'Clearance', trigger: 'Per case', description: 'Creates the HR checklist and reviews knowledge-transfer and document requirements.' },
  { key: 'it_agent', name: 'IT Agent', group: 'Clearance', trigger: 'On approval', description: 'Plans role-aware access removal and IT clearance after manager approval.' },
  { key: 'finance_agent', name: 'Finance Agent', group: 'Clearance', trigger: 'On approval', description: 'Checks financial clearance after the earlier exit stages are complete.' },
  { key: 'exit_checklist_generator_agent', name: 'Exit Checklist Generator', group: 'Clearance', trigger: 'Per case', description: 'Builds a role- and department-specific exit checklist.' },
  { key: 'kt_document_reviewer_agent', name: 'KT Document Reviewer', group: 'Clearance', trigger: 'Per case', description: 'Reviews handover notes for gaps and suggests follow-up tasks.' },
  { key: 'compliance_verification_agent', name: 'Compliance Verification', group: 'Clearance', trigger: 'On approval', description: 'Verifies approvals, asset return, NDA evidence, access revocation, and finance state.' },
  { key: 'multi_system_clearance_agent', name: 'Multi-System Clearance', group: 'Clearance', trigger: 'Per case', description: 'Consolidates clearance status from IT, HR, finance, and document records.' },
  { key: 'document_collection_agent', name: 'Document Collection', group: 'Clearance', trigger: 'Per case', description: 'Tracks required uploads and validates submitted documents using OCR rules.' },
  { key: 'it_deprovisioning_agent', name: 'Automated IT Deprovisioning', group: 'Clearance', trigger: 'On approval', description: 'Prepares and executes approved IT deprovisioning plans.' },
  { key: 'email_drafting_agent', name: 'Email Drafting', group: 'Communication', trigger: 'Per case', description: 'Drafts and sends stage-specific exit notifications and reminders.' },
  { key: 'faq_chatbot_agent', name: 'FAQ Chatbot', group: 'Communication', trigger: 'Per case', description: 'Answers employee questions from the approved exit-policy knowledge base.' },
  { key: 'sla_escalation_agent', name: 'SLA Escalation', group: 'Communication', trigger: 'Manual', description: 'Finds overdue clearances and prepares contextual escalation messages.' },
  { key: 'exit_interview_summarizer_agent', name: 'Exit Interview Summarizer', group: 'Intelligence', trigger: 'Per case', description: 'Turns interview responses into a summary, sentiment, themes, and recommendations.' },
  { key: 'exit_risk_assessment_agent', name: 'Exit Risk Assessment', group: 'Intelligence', trigger: 'On approval', description: 'Scores exit risk and records recommended mitigation actions.' },
  { key: 'rehire_agent', name: 'Intelligent Rehire Assessment', group: 'Intelligence', trigger: 'Manual', description: 'Evaluates rehire eligibility using the recorded case evidence.' },
  { key: 'dashboard_insights_agent', name: 'Dashboard Insights', group: 'Analytics & audit', trigger: 'Manual', description: 'Analyzes exit patterns and produces a narrative report for HR.' },
  { key: 'workflow_optimizer_agent', name: 'Exit Workflow Optimizer', group: 'Analytics & audit', trigger: 'Manual', description: 'Finds workflow bottlenecks and proposes process improvements.' },
  { key: 'interview_trend_analyst_agent', name: 'Exit Interview Trend Analyst', group: 'Analytics & audit', trigger: 'Manual', description: 'Finds repeated interview themes and creates trend alerts.' },
  { key: 'policy_compliance_auditor_agent', name: 'Policy Compliance Auditor', group: 'Analytics & audit', trigger: 'Manual', description: 'Audits cases for SLA breaches, missing approvals, and skipped steps.' },
  { key: 'predictive_attrition_agent', name: 'Predictive Attrition', group: 'Analytics & audit', trigger: 'Manual', description: 'Combines risk and trend signals into department-level retention insights.' },
  { key: 'smart_routing_agent', name: 'Smart Routing', group: 'Orchestration', trigger: 'Per case', description: 'Routes clearance work to an available approver or delegate.' },
  { key: 'exit_process_orchestrator_agent', name: 'Exit Process Orchestrator', group: 'Orchestration', trigger: 'Per case', description: 'Coordinates clearance stages, handoffs, and rejection branches.' },
  { key: 'end_to_end_exit_automation_agent', name: 'End-to-End Exit Automation', group: 'Orchestration', trigger: 'Manual', description: 'Runs the complete exit workflow, including routing and exception handling.' },
]

const AGENT_ALIASES = {
  checklist_generator_agent: 'exit_checklist_generator_agent',
  interview_summarizer_agent: 'exit_interview_summarizer_agent',
  risk_agent: 'exit_risk_assessment_agent',
  rehire_assessment_agent: 'rehire_agent',
  workflow_optimizer: 'workflow_optimizer_agent',
  dashboard_insights: 'dashboard_insights_agent',
  policy_compliance_auditor: 'policy_compliance_auditor_agent',
  interview_trend_agent: 'interview_trend_analyst_agent',
  orchestrator_agent: 'exit_process_orchestrator_agent',
  e2e_automation_agent: 'end_to_end_exit_automation_agent',
}

const RUN_GROUPS = ['Clearance', 'Communication', 'Intelligence', 'Analytics & audit', 'Orchestration']
const isFailedRun = (run) => /fail|error/i.test(run.status || '') || runOutcome(run)?.label === 'Failed'
const explicitAgentKey = (run) => {
  const value = run.agent?.trim().toLowerCase()
  if (!value) return null
  const normalized = AGENT_ALIASES[value] || value
  return AGENT_CATALOG.some((agent) => agent.key === normalized) ? normalized : null
}

export function Agents() {
  const { runs, runsError, cases } = useOutletContext()
  const [selected, setSelected] = useState(null)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(now.getTime() - 7 * 86400000)
  const caseById = Object.fromEntries(cases.map((exitCase) => [exitCase.id, exitCase]))
  const attributed = Object.fromEntries(AGENT_CATALOG.map((agent) => [agent.key, []]))
  const unattributed = []
  runs.forEach((run) => {
    const key = explicitAgentKey(run)
    if (key) attributed[key].push(run)
    else unattributed.push(run)
  })
  const rows = AGENT_CATALOG.map((agent) => {
    const agentRuns = attributed[agent.key].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    const recent = agentRuns.filter((run) => new Date(run.created_at) >= weekStart)
    return { ...agent, runs: agentRuns, recentCount: recent.length, failedRecently: recent.some(isFailedRun) }
  })
  const unattributedRow = unattributed.length ? {
    key: 'unattributed', name: 'Unattributed', group: 'Unattributed', trigger: '—',
    description: 'Runs whose agent field is empty or does not match a named agent. They are not guessed from the workflow stage.',
    runs: unattributed.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    recentCount: unattributed.filter((run) => new Date(run.created_at) >= weekStart).length,
    failedRecently: unattributed.filter((run) => new Date(run.created_at) >= weekStart).some(isFailedRun),
  } : null
  const allRows = unattributedRow ? [...rows, unattributedRow] : rows
  const runsToday = runs.filter((run) => new Date(run.created_at) >= todayStart).length
  const runsThisWeek = runs.filter((run) => new Date(run.created_at) >= weekStart).length
  const failedRuns = runs.filter(isFailedRun).length
  const latestRun = runs.reduce((latest, run) => !latest || new Date(run.created_at) > new Date(latest.created_at) ? run : latest, null)
  const recentActivity = [...runs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20)

  useEffect(() => {
    if (!selected) return undefined
    const close = (event) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selected])

  if (runsError) return <main className="hr-page" data-testid="hr-agents"><PageHeader title="Agents" description="See what the exit-process agents are doing." /><section className="hr-panel"><EmptyState icon="ti-lock" title="Needs backend change" body="HR cannot read agent run history under the current access policy." /></section></main>

  function statusFor(row) {
    if (!row.runs.length) return { tone: 'neutral', label: 'No runs yet' }
    if (row.failedRecently) return { tone: 'danger', label: 'Failed recently' }
    return { tone: 'success', label: 'Healthy' }
  }

  function AgentRow({ row }) {
    const status = statusFor(row)
    return <div className="hr-agent-row" role="row" tabIndex="0" onClick={() => setSelected(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(row) } }}>
      <span role="cell"><strong>{row.name}</strong><small>{row.description}</small></span>
      <span role="cell">{row.trigger}</span>
      <span role="cell">{row.runs[0]?.created_at ? formatDateTime(row.runs[0].created_at) : 'No runs yet'}</span>
      <span role="cell">{row.recentCount}</span>
      <span role="cell"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></span>
      <i className="ti ti-chevron-right" aria-hidden="true" />
    </div>
  }

  return <main className="hr-page" data-testid="hr-agents">
    <PageHeader title="Agents" description="A read-only view of automated activity across the exit process." />
    <section className="hr-agent-summary" aria-label="Agent activity summary">
      {[['Runs today', runsToday], ['Runs in last 7 days', runsThisWeek], ['Failed runs', failedRuns], ['Last activity', latestRun ? formatDateTime(latestRun.created_at) : 'No runs yet']].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>
    <section className="hr-panel hr-agent-directory"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Directory</p><h2>All agents</h2></div><span>{AGENT_CATALOG.length} agents</span></div>
      {RUN_GROUPS.map((group) => <section className="hr-agent-group" key={group}><h3>{group}</h3><div className="hr-agent-table-scroll"><div className="hr-agent-table" role="table" aria-label={`${group} agents`}><div className="hr-agent-head" role="row"><span role="columnheader">Agent and purpose</span><span role="columnheader">Trigger</span><span role="columnheader">Last run</span><span role="columnheader">Runs (7 days)</span><span role="columnheader">Status</span><span /></div>{rows.filter((row) => row.group === group).map((row) => <AgentRow row={row} key={row.key} />)}</div></div></section>)}
      {unattributedRow && <section className="hr-agent-group"><h3>Unattributed</h3><p className="hr-data-note"><i className="ti ti-info-circle" /> These records have no recognized agent name, so they have not been assigned based on stage.</p><div className="hr-agent-table-scroll"><div className="hr-agent-table" role="table" aria-label="Unattributed runs"><AgentRow row={unattributedRow} /></div></div></section>}
    </section>
    <section className="hr-panel"><div className="hr-panel-heading"><div><p className="hr-eyebrow">Latest</p><h2>Recent activity</h2></div><span>Last {recentActivity.length}</span></div>{recentActivity.length ? <div className="hr-agent-activity">{recentActivity.map((run) => { const summary = runSummary(run); const exitCase = caseById[run.case_id]; return <article key={run.id}><span className="hr-activity-icon"><i className={`ti ${runStepIcon(run.stage)}`} /></span><div><strong>{summary.text}</strong><small>{exitCase?.employee_name || runStepLabel(run.stage)}{summary.note ? ` · ${summary.note}` : ''}</small></div><time>{formatDateTime(run.created_at)}</time>{exitCase && <Link to={`/hr/exits/${exitCase.id}`} aria-label={`Open ${exitCase.employee_name}'s case`}><i className="ti ti-arrow-right" /></Link>}</article>})}</div> : <EmptyState icon="ti-activity" title="No agent activity yet" />}</section>
    {selected && <div className="hr-agent-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><aside className="hr-agent-drawer" role="dialog" aria-modal="true" aria-labelledby="hr-agent-drawer-title"><header><div><p className="hr-eyebrow">Agent activity</p><h2 id="hr-agent-drawer-title">{selected.name}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="Close agent details" autoFocus><i className="ti ti-x" /></button></header><p>{selected.description}</p><dl><div><dt>Trigger</dt><dd>{selected.trigger}</dd></div><div><dt>Runs in last 7 days</dt><dd>{selected.recentCount}</dd></div></dl><h3>Last 10 runs</h3>{selected.runs.length ? <div className="hr-agent-run-list">{selected.runs.slice(0, 10).map((run) => { const summary = runSummary(run); const outcome = runOutcome(run); const exitCase = caseById[run.case_id]; return <article key={run.id}><div><time>{formatDateTime(run.created_at)}</time>{outcome && <StatusBadge tone={outcome.tone?.replace('t-', '') || 'neutral'}>{outcome.label}</StatusBadge>}</div><strong>{exitCase?.employee_name || 'Case unavailable'}</strong><p>{summary.text}{summary.note ? `. ${summary.note}` : ''}</p><details><summary>View details</summary><pre>{JSON.stringify({ agent: run.agent, stage: run.stage, status: run.status, detail: run.detail, metadata: run.metadata }, null, 2)}</pre></details>{exitCase && <Link to={`/hr/exits/${exitCase.id}`}>Open case <i className="ti ti-arrow-right" /></Link>}</article>})}</div> : <EmptyState icon="ti-activity" title="No runs yet" body="No activity has been recorded for this agent." />}</aside></div>}
  </main>
}
