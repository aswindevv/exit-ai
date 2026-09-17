import { svc, casesFor } from './lib.mjs'
const db = svc()
const { data: p } = await db.from('profiles').select('*').eq('employee_id','Emp030').maybeSingle()
console.log('Emp030 profile:', JSON.stringify(p))
console.log('cases for Emp030:', JSON.stringify(await casesFor('Emp030')))
for (const t of ['exit_cases','exit_tasks','agent_runs','compliance_checks','case_documents','kt_reviews','exit_interviews','profiles']) {
  const { count } = await db.from(t).select('id',{count:'exact',head:true})
  console.log('count', t, count)
}
const { data: mgrs } = await db.from('profiles').select('id,full_name,email,role').eq('role','manager')
console.log('managers:', JSON.stringify(mgrs))
