import { svc, casesFor } from './lib.mjs'
const db = svc()
const TITLES = { HR: 'HR Specialist', Engineering: 'Software Engineer', Sales: 'Sales Executive' }
const MGR = '7a43e75e-7b0e-46ad-8d6e-f278e9b3f81e'
const HR = '24774c6e-bf6b-430f-8ba6-621fe8a5c78c'
const out = {}
for (const id of ['Emp032','Emp033','Emp034']) {
  const existing = await casesFor(id)
  if (existing.length) { console.log('SKIP, already has case', id, JSON.stringify(existing)); out[id]=existing[0].id; continue }
  const { data: p } = await db.from('profiles').select('*').eq('employee_id', id).single()
  const { data, error } = await db.from('exit_cases').insert({
    employee_id: p.employee_id, employee_name: p.full_name, email: p.email,
    department: p.department, role_title: TITLES[p.department] ?? 'Specialist',
    manager_id: MGR, hr_id: HR, last_working_day: '2026-10-31',
    resignation_reason: 'REVIEW-DISPOSABLE: track C3 orchestration test case.',
  }).select().single()
  if (error) { console.log('ERR', id, error.message); continue }
  out[id] = data.id
  console.log(id, '->', data.id, 'status=', data.status)
}
console.log('MAP', JSON.stringify(out))
