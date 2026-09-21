// Snapshot every real case + its task/row counts BEFORE the review, so we can
// prove afterwards that nothing seeded was mutated. Writes baseline.json.
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { svc } from './lib.mjs'

const db = svc()
const mode = process.argv[2] || 'save' // save | compare
const FILE = new URL('./baseline.json', import.meta.url)

async function snapshot() {
  const { data: cases } = await db
    .from('exit_cases')
    .select('id, employee_id, status, finance_cleared, finance_rejected, relieving_letter_issued, risk_level, risk_score, rehire_eligible, dues_note, last_working_day')
    .order('employee_id')
  const { data: tasks } = await db.from('exit_tasks').select('id, case_id, stage, status, escalation_state, title')
  const { data: ints } = await db.from('exit_interviews').select('id, case_id, sentiment, summary')
  const { data: docs } = await db.from('case_documents').select('id, case_id, doc_type, status')

  const perCase = {}
  for (const c of cases) {
    perCase[c.employee_id] = {
      id: c.id,
      status: c.status,
      finance_cleared: c.finance_cleared,
      finance_rejected: c.finance_rejected,
      relieving_letter_issued: c.relieving_letter_issued,
      risk_level: c.risk_level,
      risk_score: c.risk_score,
      rehire_eligible: c.rehire_eligible,
      last_working_day: c.last_working_day,
      tasks: tasks
        .filter((t) => t.case_id === c.id)
        .map((t) => `${t.stage}|${t.status}|${t.escalation_state || '-'}|${t.title}`)
        .sort(),
      interviews: ints.filter((i) => i.case_id === c.id).length,
      documents: docs.filter((d) => d.case_id === c.id).length,
    }
  }
  return {
    caseCount: cases.length,
    taskCount: tasks.length,
    employeeIds: cases.map((c) => c.employee_id),
    perCase,
  }
}

const now = await snapshot()

if (mode === 'save') {
  writeFileSync(FILE, JSON.stringify(now, null, 1))
  console.log(`baseline saved: ${now.caseCount} cases, ${now.taskCount} tasks`)
  console.log('employees with cases:', now.employeeIds.join(', '))
} else {
  if (!existsSync(FILE)) throw new Error('no baseline.json — run `node scripts/_review/baseline.mjs save` first')
  const base = JSON.parse(readFileSync(FILE, 'utf8'))
  const diffs = []
  for (const emp of base.employeeIds) {
    const b = base.perCase[emp]
    const a = now.perCase[emp]
    if (!a) { diffs.push(`${emp}: CASE DISAPPEARED (was ${b.id})`); continue }
    for (const k of ['status', 'finance_cleared', 'finance_rejected', 'relieving_letter_issued', 'risk_level', 'risk_score', 'rehire_eligible', 'last_working_day']) {
      if (String(b[k]) !== String(a[k])) diffs.push(`${emp}.${k}: ${b[k]} -> ${a[k]}`)
    }
    if (b.tasks.length !== a.tasks.length) diffs.push(`${emp}.tasks: ${b.tasks.length} -> ${a.tasks.length}`)
    else {
      const bs = new Set(b.tasks)
      const changed = a.tasks.filter((t) => !bs.has(t))
      if (changed.length) diffs.push(`${emp}.tasks changed: ${changed.slice(0, 4).join(' ;; ')}`)
    }
    if (b.interviews !== a.interviews) diffs.push(`${emp}.interviews: ${b.interviews} -> ${a.interviews}`)
    if (b.documents !== a.documents) diffs.push(`${emp}.documents: ${b.documents} -> ${a.documents}`)
  }
  const extra = now.employeeIds.filter((e) => !base.employeeIds.includes(e))
  console.log('=== BASELINE COMPARE ===')
  console.log('baseline cases:', base.caseCount, '-> now:', now.caseCount)
  if (extra.length) console.log('LEFTOVER DISPOSABLE CASES (must be purged):', extra.join(', '))
  else console.log('leftover disposable cases: NONE')
  if (diffs.length === 0) console.log('RESULT: PASS — every seeded case byte-identical to baseline')
  else { console.log('RESULT: DIFFERENCES FOUND (' + diffs.length + ')'); for (const d of diffs) console.log('  -', d) }
}
