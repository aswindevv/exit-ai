import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import Placeholder from '../shared/Placeholder'
import { supabase } from '../../lib/supabase'
import { fmtDate, daysUntil } from '../../lib/format'
import perficientLogo from '../../assets/perficient-logo.png'

const STAGE_LABELS = { hr: 'Resignation', manager: 'Manager & KT', it: 'IT clearance', compliance: 'Compliance clearance', finance: 'Finance clearance' }
const STAGE_ORDER = ['hr', 'manager', 'it', 'finance']
// Broader than STAGE_ORDER/exit_case_cleared_for_relieving() (0017, which
// excludes compliance because it's agent-only with no manual UI toggle) --
// this is the employee-facing "is my exit actually, fully done" gate, and
// the user asked for compliance included.
const REQUIRED_STAGES = ['hr', 'manager', 'it', 'compliance', 'finance']
const CIRCUMFERENCE = 201
const BTN = { fontSize: 11, padding: '4px 9px' }
// The dashboard checklist previews My tasks rather than repeating it in full.
const CHECKLIST_PREVIEW = 5

// Always renders all 5 nodes (Resignation, Manager & KT, IT clearance,
// Finance clearance, Relieving) even when a stage has no tasks yet -- a stage
// with zero tasks hasn't STARTED, which is not the same as being done.
//
// State is strictly ordered, so the rendered timeline can never contradict
// itself: walking the stages in order, everything stays DONE until the first
// stage that isn't complete; that one is CURRENT (or BLOCKED), and every
// stage after it is PENDING regardless of its own tasks. A later stage whose
// own rows happen to be finished therefore cannot show Done while an earlier
// stage is still open.
//
// Dates: the schema records no per-task completion timestamp (exit_tasks has
// created_at/due_date, no completed_at), so a done stage cannot claim a
// completion date it doesn't have -- showing its due_date instead is what put
// a future "26 Sept" on finished stages while Relieving showed its real, and
// earlier, issued_at. Relieving is the one stage with a real timestamp
// (exit_cases.issued_at) and is the only node that carries a date; the rest
// carry their state. Nothing here can render out of order as a result.
function stageState(tasks) {
  // The escalation row (supervisor.py's _escalate / service.py's
  // reject_manager_task) is a manager-stage row that HR closes through
  // escalation_state, never through status -- it stays 'pending' forever, so
  // it blocks while open and is otherwise not outstanding work.
  const escalations = tasks.filter((t) => t.title?.startsWith('Escalated'))
  const work = tasks.filter((t) => !t.title?.startsWith('Escalated'))
  return {
    blocked: escalations.some((e) => (e.escalation_state ?? 'open') === 'open'),
    complete: work.length > 0 && work.every((t) => t.status === 'done'),
  }
}

const STATE_DATE = { current: 'In progress', blocked: 'Blocked', pending: 'Pending', done: '' }

function buildTimeline(tasksByStage, exitCase) {
  let unlocked = true // every stage so far is DONE
  const nodes = STAGE_ORDER.map((s) => {
    const { blocked, complete } = stageState(tasksByStage[s] || [])
    let state
    if (!unlocked) state = 'pending'
    else if (complete && !blocked) state = 'done'
    else { state = blocked ? 'blocked' : 'current'; unlocked = false }
    return { label: STAGE_LABELS[s], date: STATE_DATE[state], state }
  })

  const issued = exitCase?.relieving_letter_issued === true && exitCase?.issued_at
  const state = unlocked ? (issued ? 'done' : 'current') : 'pending'
  nodes.push({
    label: 'Relieving',
    // The only real completion timestamp the employee can see, and only once
    // HR has actually issued -- never last_working_day, never a stale date.
    date: state === 'done' ? fmtDate(exitCase.issued_at) : STATE_DATE[state],
    state,
  })
  return nodes
}

const LEGEND = [
  { key: 'done', label: 'Done' },
  { key: 'current', label: 'Current' },
  { key: 'pending', label: 'Pending' },
]

function ExitTimeline({ tasksByStage, exitCase, isOnHold, className = 'card card--pad' }) {
  const nodes = buildTimeline(tasksByStage, exitCase)
  const doneCount = nodes.filter((n) => n.state === 'done').length
  // The track runs between the first and last dot centres (10%..90% of the
  // row), so the fill reaches exactly the last completed dot -- not the
  // task-completion percentage it used to use, which could outrun the stages.
  const lastDone = nodes.reduce((acc, n, i) => (n.state === 'done' ? i : acc), -1)
  const fill = lastDone > 0 ? (lastDone / (nodes.length - 1)) * 80 : 0

  return (
    <div className={className}>
      <p className="card-title card-title--tight">
        Exit timeline
        {isOnHold && <span className="tag t-danger" style={{ marginLeft: 8 }}>On hold · under HR review</span>}
      </p>

      <div className="tl-meta">
        <span className="tl-count">{doneCount} of {nodes.length} stages complete</span>
        <span className="tl-legend">
          {LEGEND.map((l) => (
            <span key={l.key} className="tl-key">
              <span className={`tl-key-dot tl-key-dot--${l.key}`} aria-hidden="true" />
              {l.label}
            </span>
          ))}
        </span>
      </div>

      <div className="timeline">
        <div className="tl-track" />
        <div className="tl-fill" style={{ width: `${fill}%` }} />
        {nodes.map((n) => (
          <div key={n.label} className={`tl-node tl-node--${n.state}`} data-stage-state={n.state}>
            <span className={`tl-dot tl-dot--${n.state}`} aria-hidden="true">
              {n.state === 'done' && <i className="ti ti-check" />}
            </span>
            <p className="tl-label">{n.label}</p>
            <p className="tl-date">{n.date}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// "Mark done" -- same shape as manager's approveTask (ManagerPages.jsx). RLS
// (0015) only lets an employee do this for their own case's 'hr'-stage
// tasks, and only to 'done', so this can't touch manager/it/finance rows or
// un-complete anything.
function useMarkDone(reload) {
  const [actioning, setActioning] = useState({})
  async function markDone(taskId) {
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
  return [actioning, markDone]
}

function deadlineTag(days) {
  if (days <= 0) return { tag: 'Due', tone: 't-danger' }
  if (days <= 3) return { tag: `${days} day${days === 1 ? '' : 's'}`, tone: 't-danger' }
  if (days <= 7) return { tag: `${days} days`, tone: 't-warning' }
  return { tag: `${days} days`, tone: 't-neutral' }
}

export function Dashboard() {
  const { profile, exitCase, tasks } = useOutletContext()
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [askResult, setAskResult] = useState(null)
  const [forwarding, setForwarding] = useState(false)
  const [forwardResult, setForwardResult] = useState(null)

  async function handleAsk() {
    if (!question.trim() || asking) return
    setAsking(true)
    setAskResult(null)
    setForwardResult(null)
    const { data: result, error } = await supabase.functions.invoke('ask', { body: { question } })
    setAsking(false)
    setAskResult(error ? { error: error.message } : result)
  }

  async function handleForward() {
    setForwarding(true)
    setForwardResult(null)
    const { data: result, error } = await supabase.functions.invoke('forward-to-hr', { body: { question } })
    setForwarding(false)
    setForwardResult(error ? { error: error.message } : result)
  }

  const done = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  const percent = total ? Math.round((done / total) * 100) : 0
  const offset = Math.round(CIRCUMFERENCE * (1 - percent / 100))
  const firstName = profile?.full_name?.split(' ')[0] ?? ''

  const isOnHold = tasks.some((t) => t.title?.startsWith('Escalated'))

  const CHIPS = [
    { tone: 't-plain', k: 'Exit ID', v: profile?.employee_id ?? '—' },
    exitCase && { tone: 't-accent', text: `Last day · ${fmtDate(exitCase.last_working_day)}` },
    isOnHold && { tone: 't-danger', text: 'On hold · under HR review' },
  ].filter(Boolean)

  const STATS = [
    { tone: 't-warning', label: 'Pending', value: String(total - done) },
    { tone: 't-success', label: 'Done', value: String(done) },
  ]

  const DEADLINES = tasks
    .filter((t) => t.status !== 'done' && t.due_date)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 3)
    .map((t) => {
      const { tag, tone } = deadlineTag(daysUntil(t.due_date))
      return { label: t.title, date: fmtDate(t.due_date), tag, tone }
    })

  // Pending first (sort is stable, so each group keeps its order), then capped:
  // the dashboard shows what's left to do, My tasks has the full list.
  const checklistPreview = [...tasks]
    .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0))
    .slice(0, CHECKLIST_PREVIEW)

  const tasksByStage = {}
  for (const t of tasks) (tasksByStage[t.stage] ??= []).push(t)

  const allStagesCleared = REQUIRED_STAGES.every(
    (s) => tasksByStage[s]?.length && tasksByStage[s].every((t) => t.status === 'done')
  )
  const isExitComplete = allStagesCleared && exitCase?.relieving_letter_issued === true

  if (isExitComplete) return <ExitComplete profile={profile} exitCase={exitCase} />

  return (
    <>
      <h2 className="sr-only">
        Employee exit dashboard with a sidebar nav, exit progress gauge, checklist, upcoming deadlines, exit timeline, and an assistant prompt.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle="Complete your pending tasks for a smooth exit."
        chips={CHIPS}
      />

      <div className="card card--pad mb gauge-card">
        <div className="gauge">
          <svg viewBox="0 0 80 80" width="76" height="76">
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--border)" strokeWidth="7" />
            <circle
              cx="40"
              cy="40"
              r="32"
              fill="none"
              stroke="var(--fill-success)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              transform="rotate(-90 40 40)"
            />
          </svg>
          <span>{percent}%</span>
        </div>
        <div className="grow">
          <p className="card-title card-title--tight">Exit progress</p>
          <div className="stat-row">
            {STATS.map((s) => (
              <span key={s.label} className={`stat ${s.tone}`}>
                {s.label} <b>{s.value}</b>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="two-col mb">
        <div className="card card--pad">
          <p className="card-title">My checklist</p>
          <div className="list list--col">
            {checklistPreview.map((t) => (
              <div key={t.id} className="row">
                <i
                  className={`ti ${t.status === 'done' ? 'ti-circle-check c-success' : 'ti-circle c-muted'}`}
                  aria-hidden="true"
                />
                <span className="grow">{t.title}</span>
                <span className={`tag ${t.status === 'done' ? 't-success' : 't-warning'}`}>
                  {t.status === 'done' ? 'Done' : 'Pending'}
                </span>
              </div>
            ))}
            {tasks.length === 0 && <p className="sub c-muted">No tasks assigned yet.</p>}
          </div>
          {tasks.length > CHECKLIST_PREVIEW && (
            <Link className="card-more" to="/employee/tasks">View all {tasks.length} tasks →</Link>
          )}
        </div>

        <div className="card card--pad">
          <p className="card-title">Upcoming deadlines</p>
          <div className="list">
            {DEADLINES.map((d) => (
              <div key={d.label} className="row row--split">
                <div>
                  <p>{d.label}</p>
                  <p className="sub">{d.date}</p>
                </div>
                <span className={`tag ${d.tone}`}>{d.tag}</span>
              </div>
            ))}
            {DEADLINES.length === 0 && <p className="sub c-muted">Nothing due right now.</p>}
          </div>
        </div>
      </div>

      <ExitTimeline
        tasksByStage={tasksByStage}
        exitCase={exitCase}
        isOnHold={isOnHold}
        className="card card--pad mb"
      />

      <div className="strip strip--top">
        <span className="strip-icon">
          <i className="ti ti-message-chatbot" aria-hidden="true" />
        </span>
        <div className="grow">
          <p className="strip-title">ExitAI assistant</p>
          {askResult?.answer ? (
            <>
              {askResult.refused ? (
                <p className="strip-body">I don't have that in our docs — I can forward your question to HR.</p>
              ) : (
                <>
                  {askResult.general && (
                    <p className="strip-body c-warning">
                      Not in our exit policy — general guidance only, please confirm with HR:
                    </p>
                  )}
                  <p className="strip-body">{askResult.answer}</p>
                  {askResult.sources?.length > 0 && (
                    <p className="strip-body c-muted">
                      {askResult.sources.length === 1 ? 'Source' : 'Sources'}:{' '}
                      {askResult.sources.map((s) => s.section || s.source).join(', ')}
                    </p>
                  )}
                </>
              )}
              {(askResult.refused || askResult.general) && (
                forwardResult?.delayed ? (
                  <p className="strip-body c-warning">{forwardResult.message}</p>
                ) : forwardResult?.ok ? (
                  <p className="strip-body c-success">Forwarded to HR — they'll get back to you.</p>
                ) : forwardResult?.error ? (
                  <p className="strip-body c-danger">{forwardResult.error}</p>
                ) : (
                  <button onClick={handleForward} disabled={forwarding} style={{ fontSize: 12, marginTop: 4 }}>
                    {forwarding ? 'Forwarding…' : 'Forward to HR'}
                  </button>
                )
              )}
            </>
          ) : askResult?.error ? (
            <p className="strip-body c-danger">{askResult.error}</p>
          ) : (
            <p className="strip-body">Ask me anything about your exit process.</p>
          )}
          <input
            className="ask-input"
            type="text"
            placeholder="e.g. When do I get my final settlement?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAsk() }}
          />
        </div>
        <button onClick={handleAsk} disabled={asking} style={{ fontSize: 12 }}>
          {asking ? 'Asking…' : 'Ask ↗'}
        </button>
      </div>
    </>
  )
}

// Letterhead-style HTML, not a real PDF -- no PDF library exists in this
// codebase (package.json has none) and adding one for a single download
// button isn't worth the new dependency. The employee can open this and
// print-to-PDF themselves if they want one.
function buildRelievingLetterHtml(profile, exitCase) {
  const issueDate = exitCase.issued_at
    ? new Date(exitCase.issued_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : ''
  const lastDay = exitCase.last_working_day
    ? new Date(exitCase.last_working_day).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Relieving letter — ${exitCase.employee_name}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color: #1a1a18; background: #faf9f7; padding: 48px; }
  .letter { max-width: 640px; margin: 0 auto; background: #fff; border: 0.5px solid #dfdcd6; border-radius: 12px; padding: 40px; }
  .co { font-size: 15px; font-weight: 600; color: #04342c; margin-bottom: 24px; }
  h1 { font-size: 18px; font-weight: 500; margin: 0 0 4px; }
  .date { font-size: 12px; color: #8b8880; margin: 0 0 24px; }
  p { font-size: 14px; line-height: 1.6; }
  .sign { margin-top: 32px; }
</style></head>
<body>
  <div class="letter">
    <p class="co">Perficient</p>
    <h1>Relieving Letter</h1>
    <p class="date">Issued ${issueDate}</p>
    <p>This is to confirm that <b>${exitCase.employee_name}</b> (${profile?.employee_id ?? '—'}), who held the
    position of <b>${exitCase.role_title}</b> in the <b>${exitCase.department}</b> department, has completed all
    exit formalities with Perficient as of their last working day, <b>${lastDay}</b>.</p>
    <p>All clearances — HR, manager/knowledge-transfer, IT, compliance, and finance — have been completed, and
    this relieving letter is issued in confirmation that the employee's exit process is fully closed.</p>
    <p>We thank ${exitCase.employee_name} for their contributions and wish them well in their future endeavours.</p>
    <p class="sign">Regards,<br>Perficient HR</p>
  </div>
</body></html>`
}

function downloadRelievingLetter(profile, exitCase) {
  const html = buildRelievingLetterHtml(profile, exitCase)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relieving-letter-${profile?.employee_id ?? 'exit'}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function ExitComplete({ profile, exitCase }) {
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  return (
    <>
      <h2 className="sr-only">Exit complete — all clearances done and relieving letter issued.</h2>

      <div className="card exit-done mb">
        <i className="ti ti-circle-check c-success exit-done-icon" aria-hidden="true" />
        <p className="card-title">
          Thank you, {firstName} — your exit is complete.
        </p>
        <p className="c-secondary exit-done-sub">
          Every stage of your offboarding has been cleared and your relieving letter has been issued.
        </p>
      </div>

      <div className="card card--pad mb">
        <p className="card-title">Exit summary</p>
        <div className="list list--col">
          {REQUIRED_STAGES.map((s) => (
            <div key={s} className="row row--split">
              <span>{STAGE_LABELS[s]}</span>
              <span className="tag t-success">Done</span>
            </div>
          ))}
          <div className="row row--split">
            <span>Relieving letter</span>
            <span className="tag t-success">
              Issued{exitCase.issued_at ? ` · ${fmtDate(exitCase.issued_at)}` : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="card card--pad">
        <button onClick={() => downloadRelievingLetter(profile, exitCase)}>
          <i className="ti ti-download" aria-hidden="true" /> Download relieving letter
        </button>
      </div>
    </>
  )
}

export function MyExit() {
  const { profile, exitCase, tasks } = useOutletContext()
  if (!exitCase) return <Placeholder title="My exit" body="No exit case found on your profile yet." />
  const done = tasks.filter((t) => t.status === 'done').length
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  return (
    <div className="card card--pad">
      <p className="card-title">My exit</p>
      <div className="list list--col">
        <div className="row row--split"><span>Employee ID</span><span className="c-secondary">{profile?.employee_id ?? '—'}</span></div>
        <div className="row row--split"><span>Department</span><span className="c-secondary">{exitCase.department}</span></div>
        <div className="row row--split"><span>Role</span><span className="c-secondary">{exitCase.role_title}</span></div>
        <div className="row row--split"><span>Last working day</span><span className="c-secondary">{fmtDate(exitCase.last_working_day)}</span></div>
        <div className="row row--split"><span>Progress</span><span className="tag t-success">{percent}% done</span></div>
      </div>
    </div>
  )
}

export function Tasks() {
  const { tasks, reload } = useOutletContext()
  const [actioning, markDone] = useMarkDone(reload)
  return (
    <div className="card card--pad">
      <p className="card-title">My tasks</p>
      <div className="list list--col">
        {tasks.map((t) => (
          <div key={t.id} className="row">
            <i
              className={`ti ${t.status === 'done' ? 'ti-circle-check c-success' : 'ti-circle c-muted'}`}
              aria-hidden="true"
            />
            <span className="grow">{t.title}</span>
            {t.due_date && <span className="sub c-muted">{fmtDate(t.due_date)}</span>}
            {t.status === 'done' ? (
              <span className="tag t-success">Done</span>
            ) : t.stage === 'hr' ? (
              <>
                <button
                  className="mark-done"
                  style={BTN}
                  onClick={() => markDone(t.id)}
                  disabled={actioning[t.id] === 'pending'}
                >
                  {actioning[t.id] === 'pending' ? 'Saving…' : 'Mark done'}
                </button>
                {actioning[t.id] && actioning[t.id] !== 'pending' && (
                  <span className="sub c-danger">{actioning[t.id]}</span>
                )}
              </>
            ) : (
              <span className="tag t-warning">Pending</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Mirrors agents/doc_collection.py's BASE_REQUIRED_DOCS/DEPT_EXTRA_DOCS --
// same source of truth, kept in sync by hand since the required list is
// deterministic and rarely changes (see that module's docstring).
const REQUIRED_DOCS_BASE = ['NDA', 'Asset Return Form']
const REQUIRED_DOCS_EXTRA = { IT: ['Company Asset Declaration'], Engineering: ['Company Asset Declaration'] }
function requiredDocuments(department) {
  return [...REQUIRED_DOCS_BASE, ...(REQUIRED_DOCS_EXTRA[department] ?? [])]
}

const DOC_META = {
  NDA: { icon: 'ti-file-signature', description: 'Signed confidentiality agreement covering the period after you leave.' },
  'Asset Return Form': { icon: 'ti-device-laptop', description: 'Confirms all company hardware and access cards have been returned.' },
  'Company Asset Declaration': { icon: 'ti-clipboard-list', description: 'Declares any company-owned equipment or accounts still in your name.' },
}
const DOC_META_DEFAULT = { icon: 'ti-file-text', description: 'Required for exit clearance.' }

// case_documents.status is 'submitted' | 'validated' | 'rejected'; no row at
// all means the doc hasn't been uploaded yet -- 'required' below.
function docState(row) {
  if (!row) return 'required'
  if (row.status === 'validated' || row.status === 'rejected') return row.status
  return 'pending'
}
const DOC_STATUS_META = {
  required: { label: 'Required', tone: 't-neutral', action: 'Upload' },
  pending: { label: 'Pending review', tone: 't-warning', action: 'Replace' },
  validated: { label: 'Validated', tone: 't-success', action: 'Replace' },
  rejected: { label: 'Rejected', tone: 't-danger', action: 'Re-upload' },
}

// agents/doc_collection.py's _validate_row writes validation_detail as
// "matched=[...] missing=[...]" -- pull out the missing list and phrase it
// as the reason an employee can act on, without touching the OCR agent that
// produced it. Falls back to the raw string for any shape it doesn't match.
function ocrRejectionReason(detail) {
  if (!detail) return null
  const missing = detail.match(/missing=\[(.*?)\]/)?.[1]?.trim()
  if (!missing) return detail
  const items = missing.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  return items.length ? `Missing or unreadable: ${items.join(', ')}` : detail
}

export function Documents() {
  const { exitCase } = useOutletContext()
  const [rows, setRows] = useState(null)
  const [uploading, setUploading] = useState({})
  const [errors, setErrors] = useState({})

  async function load() {
    const { data } = await supabase
      .from('case_documents')
      .select('*')
      .eq('case_id', exitCase.id)
      .order('created_at', { ascending: false })
    setRows(data ?? [])
  }

  useEffect(() => {
    if (exitCase) load()
  }, [exitCase])

  async function handleUpload(docType, file) {
    setUploading((u) => ({ ...u, [docType]: true }))
    setErrors((e) => ({ ...e, [docType]: '' }))
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'dat'
    const path = `${exitCase.id}/${docType}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('exit-documents').upload(path, file)
    if (uploadError) {
      setUploading((u) => ({ ...u, [docType]: false }))
      setErrors((e) => ({ ...e, [docType]: uploadError.message }))
      return
    }
    const { data: inserted, error: insertError } = await supabase
      .from('case_documents')
      .insert({ case_id: exitCase.id, doc_type: docType, file_path: path })
      .select('id')
      .single()
    if (insertError) {
      setUploading((u) => ({ ...u, [docType]: false }))
      setErrors((e) => ({ ...e, [docType]: insertError.message }))
      return
    }
    // Trigger real OCR validation: agents/service.py is a local-only bridge
    // (see ExitInterview's /submit-exit-interview call above). Non-fatal if
    // it's not running -- the row just stays 'submitted' until it is.
    try {
      await fetch('http://localhost:8787/validate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: exitCase.id, document_id: inserted.id }),
      })
    } catch {
      // agent service unreachable — non-fatal, see comment above
    }
    setUploading((u) => ({ ...u, [docType]: false }))
    await load()
  }

  if (!exitCase) return <Placeholder title="Documents" body="No exit case found on your profile yet." />
  if (rows === null) return null

  const latestByType = {}
  for (const r of rows) if (!latestByType[r.doc_type]) latestByType[r.doc_type] = r // newest-first order

  return (
    <div className="card card--pad">
      <p className="card-title">Documents</p>
      <div className="doc-grid">
        {requiredDocuments(exitCase.department).map((docType) => {
          const row = latestByType[docType]
          const state = docState(row)
          const meta = DOC_META[docType] ?? DOC_META_DEFAULT
          const { label, tone, action } = DOC_STATUS_META[state]
          const busy = !!uploading[docType]
          const reason = state === 'rejected' ? ocrRejectionReason(row?.validation_detail) : null
          return (
            <div key={docType} className="doc-card">
              <div className="doc-card-icon" aria-hidden="true">
                <i className={`ti ${meta.icon}`} />
              </div>
              <p className="doc-card-title">{docType}</p>
              <p className="doc-card-desc">{meta.description}</p>
              {reason && <p className="doc-card-reason c-danger">{reason}</p>}
              {errors[docType] && <p className="doc-card-reason c-danger">{errors[docType]}</p>}
              <div className="doc-card-foot">
                <span className={`tag ${busy ? 't-neutral' : tone}`}>{busy ? 'Uploading…' : label}</span>
                <label className={`doc-card-action${busy ? ' is-disabled' : ''}`} aria-label={`${action} ${docType}`}>
                  <i className={`ti ${action === 'Upload' ? 'ti-upload' : 'ti-refresh'}`} aria-hidden="true" />
                  {action}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => e.target.files[0] && handleUpload(docType, e.target.files[0])}
                  />
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function KnowledgeTransfer() {
  const { tasks } = useOutletContext()
  const kt = tasks.filter((t) => t.stage === 'manager')
  if (!kt.length) return <Placeholder title="Knowledge transfer" body="No knowledge-transfer tasks assigned yet." />
  return (
    <div className="card card--pad">
      <p className="card-title">Knowledge transfer</p>
      <div className="list list--col">
        {kt.map((t) => (
          <div key={t.id} className="row row--split">
            <div>
              <p>{t.title}</p>
              {t.due_date && <p className="sub">{fmtDate(t.due_date)}</p>}
            </div>
            <span className={`tag ${t.status === 'done' ? 't-success' : 't-warning'}`}>
              {t.status === 'done' ? 'Approved' : 'Pending review'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExitInterview() {
  const { exitCase } = useOutletContext()
  const [status, setStatus] = useState('loading') // loading | form | submitted
  const [reason, setReason] = useState('')
  const [feedback, setFeedback] = useState('')
  const [wouldRecommend, setWouldRecommend] = useState('')
  const [comments, setComments] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!exitCase) return
    supabase.from('employee_interview_status_view').select('case_id').maybeSingle()
      .then(({ data }) => setStatus(data ? 'submitted' : 'form'))
  }, [exitCase])

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy || !reason || !wouldRecommend) return
    setBusy(true)
    setError('')
    const { error } = await supabase.from('exit_interviews').insert({
      case_id: exitCase.id,
      reason_for_leaving: reason,
      feedback,
      would_recommend: wouldRecommend === 'yes',
      comments,
    })
    if (error) {
      setBusy(false)
      setError(error.message)
      return
    }
    // Trigger the Exit-Interview agent: agents/service.py is a local-only
    // bridge (see Resignation's /activate-exit call above). If it's not
    // running, the row is still written -- HR's analysis just won't have
    // populated yet.
    try {
      await fetch('http://localhost:8787/submit-exit-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: exitCase.id }),
      })
    } catch {
      // agent service unreachable — non-fatal, see comment above
    }
    setBusy(false)
    setStatus('submitted')
  }

  if (!exitCase) return <Placeholder title="Exit interview" body="No exit case found on your profile yet." />
  if (status === 'loading') return null

  if (status === 'submitted') {
    return (
      <div className="card card--pad">
        <p className="card-title">Exit interview</p>
        <p className="c-secondary">Thanks — your exit interview has been submitted.</p>
      </div>
    )
  }

  return (
    <div className="card card--pad">
      <p className="card-title card-title--tight">Exit interview</p>
      <p className="card-sub">Your responses are confidential and reviewed by HR.</p>

      <form onSubmit={handleSubmit}>
        <div className="form-fields">
          <div className="field">
            <label htmlFor="ei-reason">Reason for leaving</label>
            <input id="ei-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="ei-feedback">Feedback</label>
            <textarea id="ei-feedback" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="ei-recommend">Would you recommend this company to a friend?</label>
            <select id="ei-recommend" value={wouldRecommend} onChange={(e) => setWouldRecommend(e.target.value)} required>
              <option value="" disabled>Select one</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="ei-comments">Additional comments</label>
            <textarea id="ei-comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
        </div>

        {error && <p className="login-error">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={busy || !reason || !wouldRecommend}>
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function Timeline() {
  const { exitCase, tasks } = useOutletContext()
  const tasksByStage = {}
  for (const t of tasks) (tasksByStage[t.stage] ??= []).push(t)
  const isOnHold = tasks.some((t) => t.title?.startsWith('Escalated'))

  // Same component the dashboard renders -- one timeline, one state machine.
  return <ExitTimeline tasksByStage={tasksByStage} exitCase={exitCase} isOnHold={isOnHold} />
}

export function Resignation({ session }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('profiles').select('full_name').eq('id', session.user.id).single()
      .then(({ data }) => setName(data?.full_name?.split(' ')[0] ?? ''))
  }, [session])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!lastDay || busy) return
    setBusy(true)
    setError('')
    const { data, error } = await supabase.functions.invoke('submit-resignation', {
      body: { last_working_day: lastDay, reason },
    })
    if (error || data?.error) {
      setBusy(false)
      setError(data?.error ?? error.message)
      return
    }
    // Trigger the exit pipeline: agents/service.py is a local-only bridge
    // (the submit-resignation Edge Function runs in Supabase's cloud and
    // can't reach it). If it's not running, the case still exists — the
    // checklist/manager email just won't have fired yet.
    try {
      await fetch('http://localhost:8787/activate-exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: data.case.id }),
      })
    } catch {
      // agent service unreachable — non-fatal, see comment above
    }
    setBusy(false)
    navigate('/employee', { replace: true })
  }

  return (
    <div className="login-shell">
      <div className="login-brand-panel">
        <div className="login-brand-mark">
          <img src={perficientLogo} alt="Perficient" className="login-brand-logo" />
          <span className="login-brand-co">Perficient</span>
        </div>
        <div className="login-brand-copy">
          <h1>ExitAI</h1>
          <p>Before you can see your exit dashboard, tell us when you're leaving.</p>
        </div>
      </div>

      <div className="login-form-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="brand mb">
            <img src={perficientLogo} alt="Perficient" className="brand-logo" />
            <span className="brand-name">ExitAI</span>
          </div>

          <h2 style={{ margin: '0 0 4px' }}>Submit your resignation{name ? `, ${name}` : ''}</h2>
          <p className="c-secondary" style={{ margin: '0 0 8px', fontSize: 13 }}>
            This starts your exit case. Your checklist, IT, and manager steps follow once HR reviews it.
          </p>

          <label className="login-label" htmlFor="resign-last-day">Last working day</label>
          <input
            id="resign-last-day"
            type="date"
            value={lastDay}
            onChange={(e) => setLastDay(e.target.value)}
            required
          />

          <label className="login-label" htmlFor="resign-reason">Reason (optional)</label>
          <textarea
            id="resign-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          {error && <p className="login-error">{error}</p>}

          <button type="submit" disabled={busy || !lastDay} className="login-submit">
            {busy ? 'Submitting…' : 'Confirm resignation'}
          </button>
        </form>
      </div>
    </div>
  )
}
