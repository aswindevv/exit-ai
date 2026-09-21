import { daysUntil } from './format'

// JS port of agents/analytics/policy_auditor.py::audit_cases + its
// sla_escalation.find_breaches dependency -- same three checks, same
// thresholds, so the live page and the CLI agent agree on what a breach is.
// Computed here (not read from the last analytics_insights row) so the
// counts reflect the database right now, not whenever the auditor last ran.
const ACTIVE_STATUSES = new Set(['open', 'in_progress'])
const THRESHOLD_DAYS = 5
// Blocker naming here is the team/role label, not a live profile lookup --
// HrLayout doesn't load all profiles, and a name isn't needed to fix the
// staleness bug.
const STAGE_BLOCKER = { hr: 'HR', manager: 'the manager', it: 'the IT team', finance: 'the Finance team', compliance: 'the HR/Compliance team' }

function slaBreaches(tasks) {
  const breaches = []
  for (const t of tasks) {
    if (t.status !== 'pending' || !t.due_date) continue
    const daysOverdue = -daysUntil(t.due_date)
    if (daysOverdue < THRESHOLD_DAYS) continue
    breaches.push({
      task_id: t.id, case_id: t.case_id, stage: t.stage, title: t.title,
      days_overdue: daysOverdue, blocker: STAGE_BLOCKER[t.stage] ?? `the ${t.stage} team`,
    })
  }
  return breaches
}

/**
 * @param cases exit_cases rows
 * @param tasks exit_tasks rows (all statuses, all cases)
 * @param approvedCaseIds Set of case ids with a logged manager-gate approval
 */
export function auditCases(cases, tasks, approvedCaseIds) {
  const tasksByCase = {}
  for (const t of tasks) (tasksByCase[t.case_id] ??= []).push(t)

  const active = cases.filter((c) => ACTIVE_STATUSES.has(c.status))
  const breaches = []

  for (const c of active) {
    const caseTasks = tasksByCase[c.id] ?? []
    const stagesPresent = new Set(caseTasks.map((t) => t.stage))

    for (const b of slaBreaches(caseTasks.filter((t) => t.status === 'pending'))) {
      breaches.push({ check: 'sla_breach', case_id: c.id, employee_name: c.employee_name, detail: b })
    }

    const progressed = stagesPresent.has('it') || stagesPresent.has('finance')
    if (progressed && !approvedCaseIds.has(c.id)) {
      breaches.push({
        check: 'missing_approval', case_id: c.id, employee_name: c.employee_name,
        detail: 'it/finance-stage tasks exist with no logged manager-gate approval for this case',
      })
    }

    if (stagesPresent.has('finance') && !stagesPresent.has('compliance')) {
      breaches.push({
        check: 'skipped_step', case_id: c.id, employee_name: c.employee_name,
        detail: 'finance-stage task exists but compliance check (#13) never ran for this case',
      })
    }
  }

  const breachesByCheck = {}
  for (const b of breaches) breachesByCheck[b.check] = (breachesByCheck[b.check] ?? 0) + 1

  return { cases_audited: active.length, breach_count: breaches.length, breaches_by_check: breachesByCheck, breaches }
}
