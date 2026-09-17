import { svc } from './lib.mjs'
const db = svc()
for (const id of ['Emp021','Emp022']) {
  const { data: p } = await db.from('profiles').select('id,employee_id,email,full_name,role').eq('employee_id', id)
  const { data: c } = await db.from('exit_cases').select('id,status,employee_id').eq('employee_id', id)
  console.log(id, JSON.stringify(p), 'cases=', JSON.stringify(c))
}
const { data: roles } = await db.from('profiles').select('role').limit(200)
const agg = {}; for (const r of roles) agg[r.role] = (agg[r.role]||0)+1
console.log('role counts', JSON.stringify(agg))
