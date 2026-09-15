import { initials } from '../lib/format'

// Shared employee-header grouping for task/case lists scattered by employee
// across the Finance/IT/HR/Manager dashboards. Callers pass an already
// case-creation-sorted array (Array.sort is stable, so same-employee rows
// stay contiguous) -- this just inserts one header before each new
// employee's first row. No new grouping data structure, no new CSS: the
// header reuses the existing `row`/`sub` tokens already used everywhere else.
export function EmployeeGroupHeader({ name, subtitle, chip }) {
  return (
    <div className="row" data-group-header="true">
      <span className="avatar-sm">{initials(name)}</span>
      <p style={{ fontWeight: 600, marginLeft: 8 }}>{name}</p>
      {subtitle && <span className="sub" style={{ marginLeft: 8 }}>{subtitle}</span>}
      {chip && <span className={`tag ${chip.tone}`} style={{ marginLeft: 8 }}>{chip.label}</span>}
    </div>
  )
}

// sortedRows: pre-sorted by case creation. keyOf/headerOf/rowOf read each row.
export function withEmployeeHeaders(sortedRows, keyOf, headerOf, rowOf) {
  let lastKey
  const out = []
  for (const row of sortedRows) {
    const key = keyOf(row)
    if (key !== lastKey) {
      out.push(<EmployeeGroupHeader key={`grp-${key}`} {...headerOf(row)} />)
      lastKey = key
    }
    out.push(rowOf(row))
  }
  return out
}

// Case-scoped dashboards (Manager/Finance/HR) see every stage for a case, so
// "zero pending rows found" is a false positive while a case is still early
// in its pipeline -- a downstream stage's tasks don't exist as rows yet
// (confirmed live: Noah Patel/Liam Sharma, both exit_cases.status =
// 'in_progress', showed "All done" because every row THAT EXISTS happens to
// be done). requiredStages, when passed, must all be present among the
// case's rows before trusting pendingCount === 0. Mirrors
// readyForRelievingLetter's stage-presence check (HrPages.jsx). IT never
// passes this -- it's stage-scoped by RLS already (it_task_view), and a
// missing stage there just means the employee has no IT tasks at all.
export const CASE_GATE_STAGES = ['hr', 'manager', 'it', 'finance']

// Every task belonging to a case (from the caller's own accessible task set
// -- not a filtered/visible-only slice like "pending" or "done") is done.
export function caseTaskSummary(caseId, tasks, requiredStages) {
  const relevant = tasks.filter((t) => t.case_id === caseId)
  const notDoneCount = relevant.filter((t) => t.status !== 'done').length
  // A required stage with zero rows hasn't started -- count it as pending too,
  // so the chip doesn't say "0 pending" for a case that isn't actually done.
  const missingStages = requiredStages ? requiredStages.filter((s) => !relevant.some((t) => t.stage === s)).length : 0
  return {
    allDone: relevant.length > 0 && missingStages === 0 && notDoneCount === 0,
    pendingCount: notDoneCount + missingStages,
  }
}

export function completionChip(caseId, tasks, requiredStages) {
  const { allDone, pendingCount } = caseTaskSummary(caseId, tasks, requiredStages)
  return allDone ? { tone: 't-success', label: 'All done' } : { tone: 't-warning', label: `${pendingCount} pending` }
}

// Two-tier group order: any case with a pending task stays in the top tier,
// FCFS by case creation date; fully-done cases sink to the bottom (also FCFS
// within that tier). allDoneOf/dateOf read the row the same way keyOf does.
export function tieredByCompletion(rows, allDoneOf, dateOf) {
  return [...rows].sort((a, b) => {
    const tier = (allDoneOf(a) ? 1 : 0) - (allDoneOf(b) ? 1 : 0)
    return tier !== 0 ? tier : dateOf(a) - dateOf(b)
  })
}
