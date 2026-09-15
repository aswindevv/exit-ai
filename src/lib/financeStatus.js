// Mirrors agents/finance_agent.py's _check_clearance gate exactly: a finance
// task's own `status` column is binary (done only once truly cleared) and
// its `title` is the only field distinguishing "blocked" from "ready", so a
// UI that trusts `status === 'done'` alone (or a stale row where a prior
// stage regressed after the finance task was marked done) can show "Signed"
// for a blocked case. Recomputing from the same source data the agent uses
// -- prior-stage task statuses + exit_cases.finance_cleared -- reflects real
// case state instead of trusting the task row.
const PRIOR_STAGES = ['hr', 'manager', 'it']

export function financeStatus(caseRow, tasks) {
  const priors = tasks.filter((t) => t.case_id === caseRow.id && PRIOR_STAGES.includes(t.stage))
  const stagesDone = priors.length > 0 && priors.every((t) => t.status === 'done')
  if (!stagesDone) return 'blocked'
  if (caseRow.finance_rejected) return 'held'
  return caseRow.finance_cleared ? 'cleared' : 'ready'
}

// Shared tag styling for the 4 states, reused by the HR and Finance dashboards
// so a case reads the same way ("Blocked"/"Pending"/"Held"/"Signed") everywhere.
export const FINANCE_STATUS_TAG = {
  blocked: { tone: 't-danger', label: 'Blocked' },
  ready: { tone: 't-warning', label: 'Pending' },
  held: { tone: 't-danger', label: 'Held' },
  cleared: { tone: 't-success', label: 'Signed' },
}
