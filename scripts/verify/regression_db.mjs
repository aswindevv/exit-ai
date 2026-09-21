// REGRESSION 11, 18, 20 — finance actionable case, RLS enforcement, DB consistency.
// Entirely read-only against seeded data.
import { svc, anonAs, ACCOUNTS, employee } from './lib.mjs'
const db = svc()
const R = []
const check = (label, ok, detail = '') => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail}`) }

// ---------- 11. finance has an actionable case ----------
const PRIOR = ['hr', 'manager', 'it']
const { data: cases } = await db.from('exit_cases').select('id,employee_id,status,finance_cleared,finance_rejected,risk_level,risk_score,relieving_letter_issued')
const { data: tasks } = await db.from('exit_tasks').select('id,case_id,stage,status,title,escalation_state')
const fstat = (c) => {
  const p = tasks.filter((t) => t.case_id === c.id && PRIOR.includes(t.stage))
  if (!(p.length > 0 && p.every((t) => t.status === 'done'))) return 'blocked'
  if (c.finance_rejected) return 'held'
  return c.finance_cleared ? 'cleared' : 'ready'
}
const ready = cases.filter((c) => fstat(c) === 'ready')
check('11 finance queue has >=1 actionable case', ready.length >= 1, `ready=${ready.length} ${JSON.stringify(ready.map((c) => c.employee_id))}`)

// ---------- 18. RLS ----------
console.log('\n--- 18 RLS: HR-only assessment fields ---')
const HRONLY = ['risk_level', 'risk_score', 'rehire_eligible']
for (const [label, email, pw] of [
  ['employee Emp022', employee('Emp022').email, employee('Emp022').password],
  ['manager Aravidhan', ACCOUNTS.manager.email, ACCOUNTS.manager.password],
  ['it Aswin', ACCOUNTS.it.email, ACCOUNTS.it.password],
  ['finance Anfia', ACCOUNTS.finance.email, ACCOUNTS.finance.password],
]) {
  const { client } = await anonAs(email, pw)
  const { data: base } = await client.from('exit_cases').select(HRONLY.join(','))
  check(`18 ${label}: exit_cases risk columns`, !base || base.length === 0, `rows=${(base || []).length} (expect 0)`)
  const { data: iv } = await client.from('exit_interviews').select('summary,sentiment')
  check(`18 ${label}: exit_interviews`, !iv || iv.length === 0, `rows=${(iv || []).length} (expect 0)`)
  const { data: docs } = await client.from('exit_docs').select('id')
  check(`18 ${label}: exit_docs (RAG corpus)`, !docs || docs.length === 0, `rows=${(docs || []).length} (expect 0)`)
}
// HR positive control
const { client: siva } = await anonAs(ACCOUNTS.hr.email, ACCOUNTS.hr.password)
const { data: hrRows } = await siva.from('exit_cases').select('risk_level')
check('18 HR positive control: can read risk', (hrRows || []).length === cases.length, `rows=${(hrRows || []).length}/${cases.length}`)
// role-scoped views expose no assessment columns
for (const [v, label, email, pw] of [
  ['employee_exit_view', 'employee', employee('Emp022').email, employee('Emp022').password],
  ['manager_case_view', 'manager', ACCOUNTS.manager.email, ACCOUNTS.manager.password],
  ['finance_case_view', 'finance', ACCOUNTS.finance.email, ACCOUNTS.finance.password],
  ['it_task_view', 'it', ACCOUNTS.it.email, ACCOUNTS.it.password],
]) {
  const { client } = await anonAs(email, pw)
  const { data } = await client.from(v).select('*').limit(1)
  const cols = data && data[0] ? Object.keys(data[0]) : []
  const leak = cols.filter((c) => HRONLY.includes(c) || ['summary', 'sentiment', 'themes'].includes(c))
  check(`18 ${v} exposes no assessment cols`, leak.length === 0, `cols=${cols.length} leaked=${JSON.stringify(leak)}`)
}

// ---------- 20. DB consistency ----------
console.log('\n--- 20 data consistency ---')
const byCase = (id) => tasks.filter((t) => t.case_id === id)
const completed = cases.filter((c) => c.status === 'completed')
check('20 no completed case has pending hr/mgr/it/fin work',
  completed.every((c) => byCase(c.id).filter((t) => PRIOR.concat('finance').includes(t.stage)).every((t) => t.status === 'done')),
  `${completed.length} completed cases`)
check('20 no completed case has pending compliance',
  completed.every((c) => byCase(c.id).filter((t) => t.stage === 'compliance').every((t) => t.status === 'done')),
  completed.map((c) => `${c.employee_id}:${byCase(c.id).filter((t) => t.stage === 'compliance' && t.status !== 'done').length}`).join(' '))
check('20 every case has a risk score', cases.every((c) => c.risk_level), `${cases.filter((c) => !c.risk_level).length} missing`)
check('20 no case is "open" while carrying done work/runs',
  cases.filter((c) => c.status === 'open').every((c) => byCase(c.id).filter((t) => t.status === 'done').length === 0),
  cases.filter((c) => c.status === 'open').map((c) => c.employee_id).join(' ') || 'none open')
check('20 every case has at least one task', cases.every((c) => byCase(c.id).length > 0),
  cases.filter((c) => byCase(c.id).length === 0).map((c) => c.employee_id).join(' ') || 'none empty')
const resolvedPending = tasks.filter((t) => t.escalation_state === 'resolved' && t.status !== 'done')
check('20 no resolved escalation left pending', resolvedPending.length === 0, `${resolvedPending.length} stale`)
// relieving gate agreement
let disagree = 0
for (const c of cases) {
  const { data: dbSays } = await db.rpc('exit_case_cleared_for_relieving', { p_case_id: c.id })
  if (c.relieving_letter_issued && !dbSays) disagree++
}
check('20 relieving letters agree with the DB gate', disagree === 0, `${disagree} issued over a gate that now returns false`)
const orphanStages = tasks.filter((t) => !['hr', 'manager', 'it', 'finance', 'compliance'].includes(t.stage))
check('20 no unknown task stages', orphanStages.length === 0, `${orphanStages.length}`)
const dupes = Object.entries(cases.reduce((a, c) => ((a[c.employee_id] = (a[c.employee_id] || 0) + 1), a), {})).filter(([, n]) => n > 1)
check('20 no duplicate case per employee', dupes.length === 0, JSON.stringify(dupes))

console.log(`\nDB/RLS REGRESSION: ${R.filter(Boolean).length}/${R.length} passed`)
