import { svc } from './lib.mjs'
const db = svc()
// mirror analytics_agent._aggregate exactly, independently
const { data: cases } = await db.from('exit_cases').select('department, status, risk_level')
const { data: tasks } = await db.from('exit_tasks').select('case_id, status, stage')
const cnt = (arr, f) => { const o={}; for (const x of arr){ const k=f(x); if(k===null||k===undefined) continue; o[k]=(o[k]||0)+1 } return o }
const total_tasks = tasks.length
const done_tasks = tasks.filter(t=>t.status==='done').length
const stats = {
  total_cases: cases.length,
  cases_by_department: cnt(cases, c=>c.department),
  cases_by_status: cnt(cases, c=>c.status),
  cases_by_risk_level: cnt(cases.filter(c=>c.risk_level), c=>c.risk_level),
  pending_tasks_by_stage: cnt(tasks.filter(t=>t.status!=='done'), t=>t.stage),
  task_completion_rate: total_tasks ? Math.round(done_tasks/total_tasks*100)/100 : null,
}
console.log('INDEPENDENT_STATS ' + JSON.stringify(stats))
console.log('raw: total_tasks='+total_tasks+' done='+done_tasks+' ratio='+(done_tasks/total_tasks))
