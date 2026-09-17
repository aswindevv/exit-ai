// Manager-scope helpers, shared by the Manager dashboard card, the KT
// approvals page and the Clearances page so all three agree on what the
// manager actually owns.
//
// Scope is the `stage` column and nothing else: 'manager' rows are the
// manager's, 'it'/'finance'/'compliance' rows belong to those dashboards.
// A task whose TITLE reads like IT work but is stored as stage='manager'
// (the HR checklist LLM used to write "Revoke access to ..." into
// manager_tasks) is fixed where it is wrong -- at the row's stage, by
// agents/hr_agent.py's IT_OWNED_TITLE_RE guard and migration 0028 -- never
// by hiding it here. Hiding it in the UI would orphan it: nobody could
// action it, and agents/service.py's manager_approve requires EVERY
// manager-stage row to be done before it advances the case, so an invisible
// row would hold the gate shut for good.
//
// The escalation marker row is a manager-stage row too, but it records a
// problem rather than KT work. It is still rendered in KT approvals exactly
// as before; it is only excluded from the KT counts, which is the same rule
// manager_approve applies server-side.

export const KT_STAGE = 'manager'

export const isEscalationRow = (t) => Boolean(t.title?.startsWith('Escalated'))

// Every manager-stage row for the manager's reports, escalation rows included.
export const managerStageTasks = (tasks) => tasks.filter((t) => t.stage === KT_STAGE)

// A reroute reopens the manager gate: the KT task's own row never changes, so
// this has to look at the case's escalation row, not the row's own state.
export const hasOpenEscalation = (caseId, tasks) =>
  tasks.some((t) => t.case_id === caseId && t.escalation_state === 'open')

// One clearance sign-off per employee. Mirrors manager_approve()'s own checks
// (agents/service.py) so "Sign clearance" is only offered when the server
// would genuinely advance the case -- the button is a trigger for the
// existing gate, never a second decision:
//   escalated  an open escalation; HR must resolve or re-route it first
//   signed     every KT task approved AND the case already advanced
//   none       no KT plan has been generated for this case yet
//   pending    N of M KT tasks still awaiting the manager's Review
//   ready      every KT task approved, case not yet advanced
//
// "Advanced" is read off the stage='it' rows, not off agent_runs: the manager
// role has no SELECT policy on agent_runs (HR-only, 0009), and those rows are
// exactly what the handoff creates. Both halves are required -- some cases in
// this data got their IT plan from a full `run_case` pipeline while their KT
// rows are still pending, and "Signed" on a case the manager has not reviewed
// would be a lie. Those read as 'pending' until the KT reviews are done.
export function caseClearanceState(caseId, tasks) {
  const mine = tasks.filter((t) => t.case_id === caseId)
  const kt = mine.filter((t) => t.stage === KT_STAGE && !isEscalationRow(t))
  const approved = kt.filter((t) => t.status === 'done').length
  const base = { total: kt.length, approved }
  if (hasOpenEscalation(caseId, tasks)) return { ...base, key: 'escalated' }
  if (!kt.length) return { ...base, key: 'none' }
  if (approved < kt.length) return { ...base, key: 'pending' }
  return { ...base, key: mine.some((t) => t.stage === 'it') ? 'signed' : 'ready' }
}

export const CLEARANCE_STATE_TAG = {
  signed: { tone: 't-success', label: 'Signed' },
  ready: { tone: 't-accent', label: 'Ready to sign' },
  pending: { tone: 't-warning', label: 'Not ready' },
  escalated: { tone: 't-danger', label: 'Escalated to HR' },
  none: { tone: 't-neutral', label: 'No KT plan' },
}

// Actionable first, then the ones waiting on the manager's own KT reviews,
// then blocked/absent, then the ones already signed -- FCFS by case creation
// within each tier, the same ordering convention the task lists use.
const CLEARANCE_TIER = { ready: 0, pending: 1, escalated: 2, none: 3, signed: 4 }

export function clearanceRows(reports, tasks) {
  return reports
    .map((r) => ({ report: r, state: caseClearanceState(r.id, tasks) }))
    .sort((a, b) => {
      const tier = CLEARANCE_TIER[a.state.key] - CLEARANCE_TIER[b.state.key]
      if (tier !== 0) return tier
      return new Date(a.report.created_at ?? 0) - new Date(b.report.created_at ?? 0)
    })
}
