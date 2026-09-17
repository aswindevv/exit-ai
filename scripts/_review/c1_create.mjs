import { svc, j } from './lib.mjs'
const db = svc()
const DEPARTMENT_TITLES = { Engineering:'Software Engineer', Sales:'Sales Executive', Marketing:'Marketing Specialist', Finance:'Financial Analyst', Support:'Support Engineer', Product:'Product Analyst', Operations:'Operations Coordinator', HR:'HR Generalist' }
const { data: p } = await db.from('profiles').select('full_name,email,employee_id,department,role').eq('employee_id','Emp031').single()
if (p.role !== 'employee') throw new Error('not employee')
const { data: existing } = await db.from('exit_cases').select('id').eq('employee_id','Emp031').maybeSingle()
if (existing) { console.log('ALREADY EXISTS', existing.id); process.exit(0) }
const { data: manager } = await db.from('profiles').select('id').eq('role','manager').limit(1).single()
const { data: hr } = await db.from('profiles').select('id').eq('role','hr').limit(1).single()
const lwd = new Date(Date.now() + 30*86400000).toISOString().slice(0,10)
const { data: created, error } = await db.from('exit_cases').insert({
  employee_id: p.employee_id, employee_name: p.full_name, email: p.email, department: p.department,
  role_title: DEPARTMENT_TITLES[p.department] ?? 'Specialist',
  manager_id: manager.id, hr_id: hr.id, last_working_day: lwd,
  resignation_reason: 'C1 review disposable case - relocation',
}).select().single()
if (error) throw new Error(error.message)
console.log('CREATED', j(created))
