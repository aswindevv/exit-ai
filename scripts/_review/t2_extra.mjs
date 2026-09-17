import { svc, anonAs } from './lib.mjs'
const db = svc()
const { data: cases } = await db.from('exit_cases').select('*').order('created_at')
const { data: tasks } = await db.from('exit_tasks').select('*')
const byCase = new Map()
for (const t of tasks) { if (!byCase.has(t.case_id)) byCase.set(t.case_id, []); byCase.get(t.case_id).push(t) }

console.log('[o] status=open but work already done (stale status)')
for (const c of cases.filter(c => c.status === 'open')) {
  const ts = byCase.get(c.id) || []
  const d = ts.filter(t => t.status === 'done').length
  if (d > 0) console.log(`      - ${c.employee_id} ${c.employee_name} ${c.id} :: status=open but ${d}/${ts.length} tasks done`)
}
console.log('[p] rpc cleared_for_relieving=true but letter not issued (HR action outstanding)')
for (const c of cases) {
  const { data: ok } = await db.rpc('exit_case_cleared_for_relieving', { p_case_id: c.id })
  if (ok === true && c.relieving_letter_issued !== true) console.log(`      - ${c.employee_id} ${c.employee_name} ${c.id} :: status=${c.status}`)
}
console.log('[q] relieving letter issued while the compliance agent row says BLOCKED')
for (const c of cases.filter(c => c.relieving_letter_issued === true)) {
  const b = (byCase.get(c.id) || []).filter(t => t.stage === 'compliance' && t.status !== 'done')
  const ft = (byCase.get(c.id) || []).filter(t => t.stage === 'finance' && /blocked:/i.test(t.title))
  if (b.length || ft.length) console.log(`      - ${c.employee_id} ${c.employee_name} ${c.id} :: issued_at=${c.issued_at} :: compliance="${b.map(t=>t.title).join('|')}" :: financeTitle="${ft.map(t=>t.title+' ['+t.status+']').join('|')}"`)
}
console.log('[r] done tasks whose TITLE still carries a "-- blocked:" marker (UI lies without clearanceStatus.js)')
const liars = tasks.filter(t => t.status === 'done' && /--\s*blocked:/i.test(t.title))
for (const t of liars) {
  const c = cases.find(x => x.id === t.case_id)
  console.log(`      - ${c?.employee_id} [${t.stage}] ${t.title}`)
}
console.log(`      total: ${liars.length}`)

console.log('\n[views] role views under a REAL signed-in user (svc returns 0 because app_current_role() is null for service_role)')
for (const [role, email, pw, view] of [['finance','anfiacj@gmail.com','anfiacj@','finance_case_view'],['manager','aravidhan@company.com','aravidhan@','manager_case_view'],['it','aswin@gmail.com','aswin@','it_task_view']]) {
  try {
    const { client } = await anonAs(email, pw)
    const { data, error } = await client.from(view).select('*')
    console.log(`      ${view.padEnd(20)} as ${role}: ${error ? 'ERR ' + error.message : (data || []).length + ' rows'}`)
  } catch (e) { console.log(`      ${view} as ${role}: ${e.message}`) }
}
