import { anonAs, svc, ACCOUNTS, employee, j } from './lib.mjs'
const db = svc()
const AR = '7a43e75e-7b0e-46ad-8d6e-f278e9b3f81e' // Aravidhan
const KAR = '0f502d00-7720-4005-b91b-1c3168ddcabd' // manager delegate

// ---- 8. manager scoping
const { data: allCases } = await db.from('exit_cases').select('id, employee_id, employee_name, manager_id')
console.log('svc total exit_cases:', allCases.length)
const byMgr = {}
allCases.forEach(c => { byMgr[c.manager_id] = (byMgr[c.manager_id]||0)+1 })
console.log('svc cases by manager_id:', j(byMgr))
const aravCaseIds = new Set(allCases.filter(c=>c.manager_id===AR).map(c=>c.id))
console.log('svc cases with manager_id=Aravidhan:', aravCaseIds.size)

const mgr = await anonAs(ACCOUNTS.manager.email, ACCOUNTS.manager.password)
const { data: mv } = await mgr.client.from('manager_case_view').select('id, employee_name')
console.log('manager_case_view as Aravidhan rows:', mv.length)
const notMine = mv.filter(r => !aravCaseIds.has(r.id))
console.log('  rows NOT owned by Aravidhan:', notMine.length, j(notMine.slice(0,5)))
console.log('  MATCH svc count?', mv.length === aravCaseIds.size)

// manager's exit_tasks reach
const { data: mt } = await mgr.client.from('exit_tasks').select('id, case_id, stage')
const { data: allTasks } = await db.from('exit_tasks').select('id, case_id, stage')
console.log('manager exit_tasks rows:', mt.length, ' svc total exit_tasks:', allTasks.length)
const mgrTasksNotOwned = mt.filter(t => !aravCaseIds.has(t.case_id))
console.log('  manager-visible tasks on cases NOT managed by Aravidhan:', mgrTasksNotOwned.length)
if (mgrTasksNotOwned.length) console.log('   sample:', j(mgrTasksNotOwned.slice(0,3)))
console.log('  manager sees stages:', j([...new Set(mt.map(t=>t.stage))]))

// ---- 9. IT scoping
const it = await anonAs(ACCOUNTS.it.email, ACCOUNTS.it.password)
const { data: iv } = await it.client.from('it_task_view').select('*')
const stageById = Object.fromEntries(allTasks.map(t=>[t.id, t.stage]))
const nonIt = iv.filter(r => stageById[r.id] !== 'it')
console.log('it_task_view rows:', iv.length, ' non-it-stage rows in it_task_view:', nonIt.length)
const svcItCount = allTasks.filter(t=>t.stage==='it').length
console.log('  svc stage=it task count:', svcItCount, ' MATCH?', svcItCount === iv.length)
console.log('  it_task_view columns:', j(Object.keys(iv[0]||{})))
// IT base table reach
const { data: itb } = await it.client.from('exit_tasks').select('id, stage')
console.log('  IT base exit_tasks rows:', itb.length, ' stages:', j([...new Set(itb.map(t=>t.stage))]))

// ---- finance reach
const fin = await anonAs(ACCOUNTS.finance.email, ACCOUNTS.finance.password)
const { data: fv } = await fin.client.from('finance_case_view').select('*')
console.log('finance_case_view rows:', fv.length, ' vs svc total cases', allCases.length, ' => finance sees ALL cases (by design per 0013)')
const { data: ft } = await fin.client.from('exit_tasks').select('id, stage')
console.log('finance base exit_tasks rows:', ft.length, ' stages:', j([...new Set(ft.map(t=>t.stage))]))

// ---- employee_interview_status_view positive test
const { data: ints } = await db.from('exit_interviews').select('case_id').limit(50)
const intCaseIds = new Set(ints.map(i=>i.case_id))
const cand = allCases.filter(c => intCaseIds.has(c.id) && /^Emp0\d\d$/.test(c.employee_id))
console.log('candidates with an exit_interview:', j(cand.slice(0,6).map(c=>c.employee_id)))
for (const c of cand.slice(0,2)) {
  const e = employee(c.employee_id)
  try {
    const cl = await anonAs(e.email, e.password)
    const { data: sv, error } = await cl.client.from('employee_interview_status_view').select('*')
    console.log(` ${c.employee_id} employee_interview_status_view rows=${sv?sv.length:0} err=${error?error.message:'-'} cols=${j(Object.keys(sv?.[0]||{}))} ownCase=${sv?.[0]?.case_id === c.id}`)
    const { data: ev } = await cl.client.from('employee_exit_view').select('*')
    console.log(`   employee_exit_view rows=${ev.length} ownOnly=${ev.every(r=>r.id===c.id)} cols=${j(Object.keys(ev[0]||{}))}`)
    // can this employee read another employee's exit_tasks?
    const other = allCases.find(x => x.id !== c.id)
    const { data: ot } = await cl.client.from('exit_tasks').select('id').eq('case_id', other.id)
    console.log(`   reads OTHER case (${other.employee_id}) exit_tasks rows=${ot.length}  (must be 0)`)
    const { data: od } = await cl.client.from('case_documents').select('id, case_id')
    console.log(`   case_documents rows=${od.length} allOwn=${od.every(d=>d.case_id===c.id)}`)
  } catch (err) { console.log(` ${c.employee_id} signin/probe fail: ${err.message}`) }
}
