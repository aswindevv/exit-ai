import { svc, j } from './lib.mjs'
const db = svc()
const { data: p } = await db.from('profiles').select('employee_id, full_name, email, role, id')
  .in('employee_id', ['Emp021','Emp022','Emp001','Emp003','Emp011'])
console.log('profiles:', j(p))
const { data: c } = await db.from('exit_cases').select('id, employee_id, employee_name, finance_cleared, finance_rejected, dues_note, status, risk_level, risk_score, rehire_eligible, relieving_letter_issued')
  .in('employee_id', ['Emp021','Emp022','Emp001','Emp003','Emp011'])
console.log('cases:', j(c))
const { data: roles } = await db.from('profiles').select('role, email, full_name, id').neq('role','employee')
console.log('non-employee profiles:', j(roles))
const { count: nDocs } = await db.from('exit_docs').select('id', { count:'exact', head:true })
console.log('exit_docs rows (svc):', nDocs)
for (const t of ['trend_alerts','analytics_insights','kt_reviews','compliance_checks','agent_runs','case_documents','exit_interviews']) {
  const { count } = await db.from(t).select('*', { count:'exact', head:true })
  console.log('svc count', t, count)
}
