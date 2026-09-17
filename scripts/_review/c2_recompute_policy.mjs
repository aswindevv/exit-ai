import { svc } from './lib.mjs'
const db = svc()
const { data: cases } = await db.from('exit_cases').select('id, employee_id, employee_name, status')
const active = cases.filter(c=>['open','in_progress'].includes(c.status))
const { data: tasks } = await db.from('exit_tasks').select('case_id, stage, status, due_date, title')
const { data: runs } = await db.from('agent_runs').select('case_id, stage, detail')
const stagesBy={}; for(const t of tasks) (stagesBy[t.case_id] ||= new Set()).add(t.stage)
const approved = new Set(runs.filter(r=>r.stage==='manager' && r.detail==='approved').map(r=>r.case_id))
const missing=[], skipped=[]
for (const c of active) {
  const st = stagesBy[c.id] || new Set()
  if ((st.has('it')||st.has('finance')) && !approved.has(c.id)) missing.push(c.employee_id+' '+c.employee_name)
  if (st.has('finance') && !st.has('compliance')) skipped.push(c.employee_id+' '+c.employee_name)
}
console.log('INDEP cases_audited (open|in_progress):', active.length)
console.log('INDEP missing_approval ('+missing.length+'):', JSON.stringify(missing))
console.log('INDEP skipped_step ('+skipped.length+'):', JSON.stringify(skipped))
console.log('INDEP sla_breach: 0 (no pending task has a past due_date; see c2_due.mjs)')
// what manager-stage agent_runs details actually exist
const md={}; for(const r of runs.filter(r=>r.stage==='manager')) md[r.detail]=(md[r.detail]||0)+1
console.log('agent_runs stage=manager detail values:', JSON.stringify(md))
console.log('distinct cases with a manager detail=approved run:', approved.size)
// compliance agent_runs vs compliance tasks
const compRunCases = new Set(runs.filter(r=>r.stage==='compliance').map(r=>r.case_id))
const compTaskCases = new Set(tasks.filter(t=>t.stage==='compliance').map(t=>t.case_id))
console.log('cases with a compliance agent_run:', compRunCases.size, '| cases with a compliance TASK:', compTaskCases.size)
console.log('cases with a compliance RUN but NO compliance task:', [...compRunCases].filter(x=>!compTaskCases.has(x)).length)
