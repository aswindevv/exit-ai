import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { withEmployeeHeaders, tieredByCompletion, caseTaskSummary, completionChip, CASE_GATE_STAGES } from '../../components/EmployeeGroup'
import { financeStatus, FINANCE_STATUS_TAG } from '../../lib/financeStatus'
import { supabase } from '../../lib/supabase'
import { fmtDate } from '../../lib/format'

const BTN = { fontSize: 11, padding: '4px 9px' }

// Mirrors ManagerPages/ItPages useApprove, but the write goes through the
// finance_mark_dues_settled RPC (0014_finance_dues_rpc.sql) instead of a
// direct table update: exit_cases has no base SELECT policy for finance (by
// design -- that's what keeps risk_score/risk_level/rehire_eligible hidden),
// and Postgres can't apply a bare UPDATE's WHERE clause to a row it has no
// SELECT policy to see. The RPC is security-definer, checks the finance role
// itself, and always sets finance_cleared = true -- forward-only, same as
// every other approve-only action in this app.
function useSettle(reload) {
  const [actioning, setActioning] = useState({})
  async function settle(caseId, duesNote) {
    setActioning((a) => ({ ...a, [caseId]: 'pending' }))
    const { error } = await supabase.rpc('finance_mark_dues_settled', {
      p_case_id: caseId,
      p_dues_note: duesNote || null,
    })
    if (error) {
      setActioning((a) => ({ ...a, [caseId]: error.message }))
      return
    }
    await reload()
    setActioning((a) => {
      const next = { ...a }
      delete next[caseId]
      return next
    })
  }
  return [actioning, settle]
}

// Symmetric counterpart to useSettle, same RPC-not-table-update reasoning.
// Mirrors ManagerPages' useReject UX (window.prompt for a required reason)
// but calls finance_reject_dues (0027) directly instead of a localhost:8787
// service -- there's no exit_tasks write here for RLS to block, so no
// service bypass is needed.
function useReject(reload) {
  const [rejecting, setRejecting] = useState({})
  async function reject(caseId) {
    const reason = window.prompt('Reason for rejecting (required), e.g. "outstanding advance not repaid":')?.trim()
    if (!reason) return
    setRejecting((r) => ({ ...r, [caseId]: 'pending' }))
    const { error } = await supabase.rpc('finance_reject_dues', {
      p_case_id: caseId,
      p_reason: reason,
    })
    if (error) {
      setRejecting((r) => ({ ...r, [caseId]: error.message }))
      return
    }
    await reload()
    setRejecting((r) => {
      const next = { ...r }
      delete next[caseId]
      return next
    })
  }
  return [rejecting, reject]
}

// Awaiting finance = hr/manager/it all done, dues not yet settled -- same
// stages finance_agent.py itself gates on (it ignores compliance/assess).
// Kept for the KPI/subtitle count -- the case list itself shows every case
// (blocked/ready/cleared) so a blocked row's real status is visible instead
// of being silently dropped from the dashboard.
function useQueue(cases, tasks) {
  return cases.filter((c) => ['ready', 'held'].includes(financeStatus(c, tasks)))
}

const financeGroupKey = (c) => c.id
// allTasks is finance's full accessible task set for this case (hr/manager/
// it/finance) -- "all done" must reflect the whole case, not just this list.
const financeGroupHeader = (allTasks) => (c) => ({
  name: c.employee_name,
  subtitle: `${c.department} · Last day ${fmtDate(c.last_working_day)}`,
  chip: completionChip(c.id, allTasks, CASE_GATE_STAGES),
})

export function Dashboard() {
  const { profile, cases, tasks, reload } = useOutletContext()
  const [actioning, settle] = useSettle(reload)
  const [rejecting, reject] = useReject(reload)
  const [notes, setNotes] = useState({})
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const queue = useQueue(cases, tasks)

  const CHIPS = [
    { tone: 't-plain', k: 'Queue', v: String(queue.length) },
    queue.length > 0 && { tone: 't-warning', text: `${queue.length} awaiting you` },
  ].filter(Boolean)

  const KPIS = [
    { label: 'Awaiting finance clearance', value: String(queue.length), valueClass: 'c-warning' },
  ]

  return (
    <>
      <h2 className="sr-only">
        Finance dashboard with a sidebar nav and a work queue of exit cases
        awaiting dues clearance.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle={`${queue.length} exit case${queue.length === 1 ? '' : 's'} awaiting finance clearance.`}
        chips={CHIPS}
      />

      <div className="kpi-row mb">
        {KPIS.map((k) => (
          <span key={k.label} className="kpi">
            {k.label} <b className={k.valueClass}>{k.value}</b>
          </span>
        ))}
      </div>

      <div className="card card--pad">
        <p className="card-title">Finance clearance queue</p>
        <div className="list">
          {withEmployeeHeaders(
            tieredByCompletion(
              [...cases],
              (c) => caseTaskSummary(c.id, tasks, CASE_GATE_STAGES).allDone,
              (c) => new Date(c.created_at)
            ),
            financeGroupKey,
            financeGroupHeader(tasks),
            (c) => {
              const financeTask = tasks.find((t) => t.case_id === c.id && t.stage === 'finance')
              const status = financeStatus(c, tasks)
              const tag = FINANCE_STATUS_TAG[status]
              const actionable = status === 'ready' || status === 'held'
              return (
                <div className="row row--split" key={c.id}>
                  <div>
                    <p className="sub">
                      Last day {fmtDate(c.last_working_day)} · {financeTask?.title ?? 'Final settlement dues'}
                    </p>
                    {status === 'held' && (
                      <p className="sub c-danger" style={{ marginTop: 2 }}>Held: {c.dues_note}</p>
                    )}
                    {actionable && (
                      <input
                        type="text"
                        placeholder="Dues note (optional)"
                        value={notes[c.id] ?? c.dues_note ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                        style={{ marginTop: 4, fontSize: 12, padding: '3px 6px', width: '100%', maxWidth: 260 }}
                      />
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {actionable ? (
                      <>
                        <button
                          style={BTN}
                          onClick={() => settle(c.id, notes[c.id] ?? c.dues_note)}
                          disabled={actioning[c.id] === 'pending' || rejecting[c.id] === 'pending'}
                        >
                          {actioning[c.id] === 'pending' ? 'Saving…' : 'Mark dues settled'}
                        </button>
                        {' '}
                        <button
                          className="c-danger"
                          style={{ ...BTN, borderColor: 'var(--text-danger)' }}
                          onClick={() => reject(c.id)}
                          disabled={actioning[c.id] === 'pending' || rejecting[c.id] === 'pending'}
                        >
                          {rejecting[c.id] === 'pending' ? 'Rejecting…' : 'Reject'}
                        </button>
                        {actioning[c.id] && actioning[c.id] !== 'pending' && (
                          <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[c.id]}</p>
                        )}
                        {rejecting[c.id] && rejecting[c.id] !== 'pending' && (
                          <p className="sub c-danger" style={{ marginTop: 2 }}>{rejecting[c.id]}</p>
                        )}
                      </>
                    ) : (
                      <span className={`tag ${tag.tone}`}>{tag.label}</span>
                    )}
                  </div>
                </div>
              )
            }
          )}
          {!cases.length && <p className="sub">No cases awaiting finance clearance.</p>}
        </div>
      </div>
    </>
  )
}
