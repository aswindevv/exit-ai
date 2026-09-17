import { svc, casesFor } from './lib.mjs'
const db = svc()
for (const id of ['Emp032','Emp033','Emp034']) {
  const { data: p } = await db.from('profiles').select('id,employee_id,full_name,email,department,role').eq('employee_id', id).maybeSingle()
  console.log(id, JSON.stringify(p))
  console.log('  existing cases:', JSON.stringify(await casesFor(id)))
}
const { data: mgr } = await db.from('profiles').select('id,full_name,email,role').in('role',['manager','hr'])
console.log('staff:', JSON.stringify(mgr))
const { data: sample } = await db.from('exit_cases').select('*').eq('employee_id','Emp010').maybeSingle()
console.log('sample case shape:', JSON.stringify(sample, null, 1))
