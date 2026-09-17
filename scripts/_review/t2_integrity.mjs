// RECON TASK 2 - DATABASE INTEGRITY SWEEP.  READ-ONLY.  svc() reads only.
import { svc } from './lib.mjs'
const db = svc()

const STAGES = ['hr', 'manager', 'it', 'finance']
const ALL_STAGES = new Set([...STAGES, 'compliance'])

const { data: cases, error: cErr } = await db.from('exit_cases').select('*').order('created_at')
if (cErr) throw cErr
const { data: tasks } = await db.from('exit_tasks').select('*')
const { data: profiles } = await db.from('profiles').select('id, role, full_name, email, employee_id')

const P = new Map(profiles.map(p => [p.id, p]))
const byCase = new Map()
for (const t of tasks) { if (!byCase.has(t.case_id)) byCase.set(t.case_id, []); byCase.get(t.case_id).push(t) }
const label = c => `${c.employee_id} (${c.employee_name}) ${c.id}`
const short = id => String(id).slice(0, 8)

const results = []
const check = (key, title, rows) => { results.push({ key, title, rows }) }

// a) completed but a hr/manager/it/finance task still pending
check('a', "status=completed but an hr/manager/it/finance task still pending",
  cases.filter(c => c.status === 'completed')
    .map(c => ({ c, bad: (byCase.get(c.id) || []).filter(t => STAGES.includes(t.stage) && t.status !== 'done') }))
    .filter(x => x.bad.length)
    .map(x => `${label(x.c)} :: ${x.bad.map(t => `[${t.stage}/${t.status}] ${t.title}`).join(' | ')}`))

// b) completed vs relieving_letter_issued mismatch (both directions)
check('b', "status=completed XOR relieving_letter_issued=true",
  cases.filter(c => (c.status === 'completed') !== (c.relieving_letter_issued === true))
    .map(c => `${label(c)} :: status=${c.status} relieving=${c.relieving_letter_issued} finance_cleared=${c.finance_cleared} issued_at=${c.issued_at || 'null'}`))

// c) relieving_letter_issued=true but the RPC says NOT cleared
const cRows = []
for (const c of cases) {
  const { data: ok, error } = await db.rpc('exit_case_cleared_for_relieving', { p_case_id: c.id })
  c._rpc = error ? `ERR:${error.message}` : ok
  if (c.relieving_letter_issued === true && ok !== true) {
    const ts = byCase.get(c.id) || []
    const have = [...new Set(ts.filter(t => STAGES.includes(t.stage)).map(t => t.stage))].sort()
    const notDone = ts.filter(t => STAGES.includes(t.stage) && t.status !== 'done')
    cRows.push(`${label(c)} :: rpc=${c._rpc} finance_cleared=${c.finance_cleared} stagesPresent=[${have.join(',')}] notDone=${notDone.length ? notDone.map(t => `[${t.stage}] ${t.title}`).join(' | ') : 'none'}`)
  }
}
check('c', "relieving_letter_issued=true but exit_case_cleared_for_relieving() returns false", cRows)

// d) finance_cleared=true but hr/manager/it tasks not all done
check('d', "finance_cleared=true but an hr/manager/it task not done",
  cases.filter(c => c.finance_cleared === true)
    .map(c => ({ c, bad: (byCase.get(c.id) || []).filter(t => ['hr', 'manager', 'it'].includes(t.stage) && t.status !== 'done') }))
    .filter(x => x.bad.length)
    .map(x => `${label(x.c)} :: ${x.bad.map(t => `[${t.stage}] ${t.title}`).join(' | ')}`))

// e) a finance-stage task done while finance_cleared=false
check('e', "finance-stage task done while finance_cleared=false",
  cases.filter(c => c.finance_cleared !== true)
    .map(c => ({ c, bad: (byCase.get(c.id) || []).filter(t => t.stage === 'finance' && t.status === 'done') }))
    .filter(x => x.bad.length)
    .map(x => `${label(x.c)} :: finance_rejected=${x.c.finance_rejected} :: ${x.bad.map(t => t.title).join(' | ')}`))

// f) cases with ZERO tasks
check('f', 'cases with ZERO exit_tasks rows',
  cases.filter(c => !(byCase.get(c.id) || []).length)
    .map(c => `${label(c)} :: status=${c.status} created=${c.created_at}`))

// g) missing an entire expected stage
check('g', 'case missing one or more of the hr/manager/it/finance stages',
  cases.map(c => {
    const have = new Set((byCase.get(c.id) || []).map(t => t.stage))
    return { c, missing: STAGES.filter(s => !have.has(s)), have: [...have].sort() }
  }).filter(x => x.missing.length && (byCase.get(x.c.id) || []).length)
    .map(x => `${label(x.c)} :: status=${x.c.status} missing=[${x.missing.join(',')}] has=[${x.have.join(',')}]`))

// h) compliance task still pending on a completed case
check('h', 'compliance-stage task still pending on a completed case',
  cases.filter(c => c.status === 'completed')
    .map(c => ({ c, bad: (byCase.get(c.id) || []).filter(t => t.stage === 'compliance' && t.status !== 'done') }))
    .filter(x => x.bad.length)
    .map(x => `${label(x.c)} :: ${x.bad.length} pending :: ${x.bad.map(t => t.title).join(' | ')}`))

// i) unknown stage values
const stageDist = {}
for (const t of tasks) stageDist[t.stage] = (stageDist[t.stage] || 0) + 1
check('i', 'exit_tasks.stage outside hr/manager/it/finance/compliance',
  tasks.filter(t => !ALL_STAGES.has(t.stage))
    .map(t => `task ${short(t.id)} stage=${t.stage} case=${short(t.case_id)} title=${t.title}`))

// j) escalations
const esc = tasks.filter(t => t.escalation_state !== null && t.escalation_state !== undefined)
const escDist = {}
for (const t of esc) escDist[t.escalation_state] = (escDist[t.escalation_state] || 0) + 1
const advanced = []
for (const t of esc.filter(x => x.escalation_state === 'open')) {
  const c = cases.find(x => x.id === t.case_id)
  if (!c) { advanced.push(`ORPHAN open escalation task ${short(t.id)} case=${short(t.case_id)}`); continue }
  const ts = byCase.get(c.id) || []
  const itDone = ts.some(x => x.stage === 'it' && x.status === 'done')
  const finDone = ts.some(x => x.stage === 'finance' && x.status === 'done')
  if (itDone || finDone || c.finance_cleared === true || c.status === 'completed') {
    advanced.push(`${label(c)} :: OPEN escalation "[${t.stage}] ${t.title}" yet status=${c.status} itTaskDone=${itDone} finTaskDone=${finDone} finance_cleared=${c.finance_cleared} relieving=${c.relieving_letter_issued}`)
  }
}
check('j', 'open escalation on a case that nonetheless advanced to it/finance', advanced)

// k) orphans
const caseIds = new Set(cases.map(c => c.id))
const orphanSummary = []
for (const t of ['exit_tasks', 'agent_runs', 'compliance_checks', 'case_documents', 'kt_reviews', 'exit_interviews']) {
  const { data } = await db.from(t).select('id, case_id')
  const o = (data || []).filter(r => !caseIds.has(r.case_id))
  orphanSummary.push(`${t}: ${(data || []).length} rows, ${o.length} orphaned${o.length ? ' -> ' + o.slice(0, 10).map(r => short(r.id) + ' -> ' + short(r.case_id)).join(', ') : ''}`)
}
check('k', 'orphan child rows (case_id with no exit_cases row)', orphanSummary.filter(l => !/, 0 orphaned$/.test(l)))

// l) duplicate cases per employee
const byEmp = {}
for (const c of cases) (byEmp[c.employee_id] ||= []).push(c)
check('l', 'more than one exit_case for one employee_id',
  Object.entries(byEmp).filter(([, v]) => v.length > 1)
    .map(([e, v]) => `${e} :: ${v.length} cases -> ${v.map(c => `${short(c.id)}(${c.status},${c.created_at.slice(0, 10)})`).join(', ')}`))

// m) manager_id / hr_id integrity + delegate split
const mgrProfiles = profiles.filter(p => p.role === 'manager')
const hrProfiles = profiles.filter(p => p.role === 'hr')
const dangling = cases.filter(c => !c.manager_id || !c.hr_id || !P.has(c.manager_id) || !P.has(c.hr_id))
  .map(c => `${label(c)} :: manager_id=${c.manager_id ? (P.has(c.manager_id) ? 'ok' : 'DANGLING ' + short(c.manager_id)) : 'NULL'} hr_id=${c.hr_id ? (P.has(c.hr_id) ? 'ok' : 'DANGLING ' + short(c.hr_id)) : 'NULL'}`)
const mgrSplit = {}, hrSplit = {}
for (const c of cases) {
  const m = P.get(c.manager_id), h = P.get(c.hr_id)
  const mk = m ? `${m.email} (${m.full_name}) ${short(m.id)}` : `UNRESOLVED ${c.manager_id}`
  const hk = h ? `${h.email} (${h.full_name}) ${short(h.id)}` : `UNRESOLVED ${c.hr_id}`
  mgrSplit[mk] = (mgrSplit[mk] || 0) + 1
  hrSplit[hk] = (hrSplit[hk] || 0) + 1
}
const mgrDelegate = mgrProfiles.filter(p => /delegate/i.test(p.email) || /delegate/i.test(p.full_name || ''))
const hrDelegate = hrProfiles.filter(p => /delegate/i.test(p.email) || /delegate/i.test(p.full_name || ''))
const delegateOwned = cases.filter(c => mgrDelegate.some(p => p.id === c.manager_id) || hrDelegate.some(p => p.id === c.hr_id))
  .map(c => `${label(c)} :: manager=${P.get(c.manager_id)?.email} hr=${P.get(c.hr_id)?.email}`)
check('m1', 'manager_id / hr_id NULL or dangling', dangling)
check('m2', 'case owned by a DELEGATE profile rather than the primary', delegateOwned)

// n) risk_score vs risk_level
const lvl = s => s >= 0.66 ? 'high' : s >= 0.4 ? 'medium' : 'low'
check('n', 'risk_score/risk_level inconsistent (>=0.66 high, >=0.4 medium, else low)',
  cases.filter(c => c.risk_score !== null && c.risk_score !== undefined)
    .filter(c => !c.risk_level || c.risk_level !== lvl(Number(c.risk_score)))
    .map(c => `${label(c)} :: risk_score=${c.risk_score} risk_level=${c.risk_level ?? 'NULL'} expected=${lvl(Number(c.risk_score))}`)
    .concat(cases.filter(c => (c.risk_score === null || c.risk_score === undefined) && c.risk_level)
      .map(c => `${label(c)} :: risk_level=${c.risk_level} but risk_score=NULL`))
    .concat(cases.filter(c => c.risk_score === null && c.risk_level === null)
      .map(c => `${label(c)} :: BOTH NULL (risk agent never ran) status=${c.status}`)))

// OUTPUT
const line = '='.repeat(104)
console.log(line)
console.log(`DB INTEGRITY SWEEP - ${cases.length} exit_cases, ${tasks.length} exit_tasks, ${profiles.length} profiles`)
console.log(line)
let failed = 0
for (const r of results) {
  const ok = r.rows.length === 0
  if (!ok) failed++
  console.log(`\n[${r.key}] ${ok ? 'CLEAN ' : 'OFFEND'}  ${r.title}   (${r.rows.length})`)
  for (const row of r.rows) console.log('      - ' + row)
}
console.log('\n' + line)
console.log('CONTEXT TABLES')
console.log(line)
const dist = (arr, f) => JSON.stringify(arr.reduce((a, x) => (a[String(f(x))] = (a[String(f(x))] || 0) + 1, a), {}))
console.log('status                  :', dist(cases, c => c.status))
console.log('relieving_letter_issued :', dist(cases, c => c.relieving_letter_issued))
console.log('finance_cleared         :', dist(cases, c => c.finance_cleared))
console.log('finance_rejected        :', dist(cases, c => c.finance_rejected))
console.log('exit_tasks.stage        :', JSON.stringify(stageDist))
console.log('exit_tasks.status       :', dist(tasks, t => t.status))
console.log('escalation_state        :', JSON.stringify(escDist), `(non-null: ${esc.length}/${tasks.length})`)
console.log('rpc cleared_for_relieving:', dist(cases, c => c._rpc))
console.log('\nmanager profiles :', mgrProfiles.map(p => `${p.email}/${p.full_name}/${short(p.id)}`).join('  |  '))
console.log('hr profiles      :', hrProfiles.map(p => `${p.email}/${p.full_name}/${short(p.id)}`).join('  |  '))
console.log('\n[m] manager_id split across all cases:')
for (const [k, v] of Object.entries(mgrSplit).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(3)}  ${k}`)
console.log('[m] hr_id split across all cases:')
for (const [k, v] of Object.entries(hrSplit).sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(3)}  ${k}`)
console.log('\n[k] child-table orphan scan (full):')
for (const l of orphanSummary) console.log('      ' + l)

console.log('\n' + line)
console.log('PER-CASE MATRIX  (stage cell = done/total)')
console.log(line)
console.log('employee  status       finClr rlv  rpc   hr      mgr     it      fin     comp    esc  risk')
for (const c of cases) {
  const ts = byCase.get(c.id) || []
  const cell = s => { const a = ts.filter(t => t.stage === s); return a.length ? `${a.filter(t => t.status === 'done').length}/${a.length}`.padEnd(7) : '  -    ' }
  const e = ts.filter(t => t.escalation_state).map(t => t.escalation_state[0]).join('') || '-'
  console.log(`${c.employee_id.padEnd(9)} ${String(c.status).padEnd(12)} ${String(c.finance_cleared)[0].toUpperCase().padEnd(6)} ${String(c.relieving_letter_issued)[0].toUpperCase().padEnd(4)} ${String(c._rpc)[0].toUpperCase().padEnd(5)} ${cell('hr')} ${cell('manager')} ${cell('it')} ${cell('finance')} ${cell('compliance')} ${e.padEnd(4)} ${c.risk_level ?? '-'}/${c.risk_score ?? '-'}`)
}
console.log(`\nSUMMARY: ${failed} of ${results.length} checks found offending rows.`)
