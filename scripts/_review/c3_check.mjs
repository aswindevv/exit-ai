import { svc } from './lib.mjs'
const db = svc()
const id = process.argv[2]
const { data: c } = await db.from('exit_cases').select('*').eq('id', id).single()
console.log('CASE', c.employee_id, 'status=', c.status, 'risk=', c.risk_level, c.risk_score, 'rehire=', c.rehire_eligible, 'finance_cleared=', c.finance_cleared)
const { data: runs } = await db.from('agent_runs').select('stage,detail,created_at').eq('case_id', id).order('created_at')
const byStage = {}
runs.forEach(r => byStage[r.stage] = (byStage[r.stage]||0)+1)
console.log('agent_runs total', runs.length, JSON.stringify(byStage))
runs.forEach((r,i) => console.log(`  ${String(i+1).padStart(2)} [${r.stage}] ${r.detail.slice(0,110)}`))
const { data: tasks } = await db.from('exit_tasks').select('stage,title,status,escalation_state,due_date').eq('case_id', id).order('stage')
const ts = {}
tasks.forEach(t => { ts[t.stage] = ts[t.stage]||{done:0,total:0}; ts[t.stage].total++; if(t.status==='done') ts[t.stage].done++ })
console.log('exit_tasks', tasks.length, JSON.stringify(ts))
tasks.forEach(t => console.log(`  [${t.stage}] ${t.status}${t.escalation_state?` esc=${t.escalation_state}`:''} :: ${t.title.slice(0,90)}`))
for (const t of ['exit_interviews','kt_reviews','compliance_checks','case_documents']) {
  const { data } = await db.from(t).select('id').eq('case_id', id)
  console.log(t, (data||[]).length)
}
