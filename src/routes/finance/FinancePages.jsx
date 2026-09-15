import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { financeStatus, FINANCE_STATUS_TAG } from '../../lib/financeStatus'
import { supabase } from '../../lib/supabase'
import { fmtDate } from '../../lib/format'

const BTN = { fontSize: 11, padding: '4px 9px' }
const PRIOR_STAGES = ['hr', 'manager', 'it']
const PRIOR_STAGE_LABEL = { hr: 'HR', manager: 'Manager', it: 'IT' }

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
    // Trigger the finance/compliance re-check: agents/service.py is the
    // same local-only bridge as every other page's fetch call. Non-fatal
    // if it's not running -- the settlement itself already stuck.
    try {
      await fetch('http://localhost:8787/finance-settle-check', {
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

// financeStatus returns 4 raw states, but the queue only has 3 visual tiers:
// 'held' is finance's own hold (still actionable -- settling is the only way
// to release it, see 0027's comment), so it sorts with 'ready' rather than
// with 'blocked' (which has no action until an earlier stage clears).
function rowTier(status) {
  if (status === 'blocked') return 1
  if (status === 'cleared') return 2
  return 0 // ready, held
}

// Short reason for a 'blocked' pill -- first prior stage (in gate order)
// that isn't fully done, matching financeStatus.js's own PRIOR_STAGES gate.
// Kept to one word so "Blocked · <reason>" stays single-line in a fixed
// column width instead of wrapping the row onto two lines.
function blockedReason(caseId, tasks) {
  const stage = PRIOR_STAGES.find((s) => {
    const stageTasks = tasks.filter((t) => t.case_id === caseId && t.stage === s)
    return stageTasks.length === 0 || !stageTasks.every((t) => t.status === 'done')
  })
  return stage ? PRIOR_STAGE_LABEL[stage] : 'Prior stage'
}

// Fixed grid-column widths for the clearance queue table -- unlike flex
// basis/shrink, a grid track's width is set once on the container and can't
// be squeezed by one row's own content (e.g. an actionable row's buttons),
// so every row's columns line up regardless of what that row renders.
const QUEUE_COLS = '1.4fr 1fr 70px 150px 170px'

export function Dashboard() {
  const { profile, cases, tasks, reload } = useOutletContext()
  const [actioning, settle] = useSettle(reload)
  const [rejecting, reject] = useReject(reload)
  const [notes, setNotes] = useState({})
  const firstName = profile?.full_name?.split(' ')[0] ?? ''

  const rows = cases
    .map((c) => ({ case: c, status: financeStatus(c, tasks) }))
    .sort((a, b) => rowTier(a.status) - rowTier(b.status) || new Date(a.case.created_at) - new Date(b.case.created_at))

  const readyCount = rows.filter((r) => r.status === 'ready' || r.status === 'held').length
  const blockedCount = rows.filter((r) => r.status === 'blocked').length
  const settledCount = rows.filter((r) => r.status === 'cleared').length

  const CHIPS = [
    { tone: 't-plain', k: 'Queue', v: String(cases.length) },
    readyCount > 0 && { tone: 't-warning', text: `${readyCount} awaiting you` },
  ].filter(Boolean)

  const KPIS = [
    { label: 'Ready', value: String(readyCount), valueClass: 'c-warning' },
    { label: 'Blocked', value: String(blockedCount), valueClass: 'c-danger' },
    { label: 'Settled', value: String(settledCount), valueClass: 'c-success' },
  ]

  return (
    <>
      <h2 className="sr-only">
        Finance dashboard with a sidebar nav and a work queue of exit cases
        awaiting dues clearance.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle={`${readyCount} exit case${readyCount === 1 ? '' : 's'} ready for finance clearance.`}
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
          <div className="thead" style={{ display: 'grid', gridTemplateColumns: QUEUE_COLS }}>
            <span>Employee</span>
            <span>Dept</span>
            <span>Last day</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Action</span>
          </div>
          {rows.map(({ case: c, status }) => {
            const tag = FINANCE_STATUS_TAG[status]
            const actionable = status === 'ready' || status === 'held'
            const reason =
              status === 'blocked' ? blockedReason(c.id, tasks) : status === 'held' && c.dues_note ? c.dues_note : null
            return (
              <div
                className="row"
                key={c.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: QUEUE_COLS,
                  alignItems: 'center',
                  ...(status === 'cleared' ? { opacity: 0.55 } : null),
                }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.employee_name}
                </span>
                <span className="c-secondary" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.department}
                </span>
                <span className="c-secondary">{fmtDate(c.last_working_day)}</span>
                <span style={{ minWidth: 0 }}>
                  <span
                    className={`tag ${tag.tone}`}
                    style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}
                  >
                    {tag.label}{reason ? ` · ${reason}` : ''}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  {actionable ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      <input
                        type="text"
                        placeholder="Dues note (optional)"
                        value={notes[c.id] ?? c.dues_note ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                        style={{ fontSize: 12, padding: '3px 6px', width: '100%' }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          style={BTN}
                          onClick={() => settle(c.id, notes[c.id] ?? c.dues_note)}
                          disabled={actioning[c.id] === 'pending' || rejecting[c.id] === 'pending'}
                        >
                          {actioning[c.id] === 'pending' ? 'Saving…' : 'Settle dues'}
                        </button>
                        <button
                          className="c-danger"
                          style={{ ...BTN, borderColor: 'var(--text-danger)' }}
                          onClick={() => reject(c.id)}
                          disabled={actioning[c.id] === 'pending' || rejecting[c.id] === 'pending'}
                        >
                          {rejecting[c.id] === 'pending' ? 'Rejecting…' : 'Reject'}
                        </button>
                      </div>
                      {actioning[c.id] && actioning[c.id] !== 'pending' && (
                        <p className="sub c-danger" style={{ margin: 0 }}>{actioning[c.id]}</p>
                      )}
                      {rejecting[c.id] && rejecting[c.id] !== 'pending' && (
                        <p className="sub c-danger" style={{ margin: 0 }}>{rejecting[c.id]}</p>
                      )}
                    </div>
                  ) : (
                    <span className="c-muted">{status === 'blocked' ? '—' : 'Done'}</span>
                  )}
                </span>
              </div>
            )
          })}
          {!cases.length && <p className="sub">No cases in finance queue.</p>}
        </div>
      </div>
    </>
  )
}
