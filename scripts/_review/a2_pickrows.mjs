import { svc, j } from './lib.mjs'
const db = svc()
// Emp001 case (finance_cleared already true, dues_note null) -> RPC no-op target
const { data: c1 } = await db.from('exit_cases').select('*').eq('employee_id','Emp001').single()
console.log('Emp001 case snapshot:', j(c1))
// an hr-stage task ALREADY done on Emp001's case (target for employee cross-case write attempt)
const { data: t1 } = await db.from('exit_tasks').select('id,case_id,stage,status,title').eq('case_id', c1.id)
console.log('Emp001 tasks:', j(t1))
// Emp022's own tasks
const { data: c22 } = await db.from('exit_cases').select('id').eq('employee_id','Emp022').single()
const { data: t22 } = await db.from('exit_tasks').select('id,stage,status,title').eq('case_id', c22.id)
console.log('Emp022 case', c22.id, 'tasks:', j(t22.map(t=>({id:t.id,stage:t.stage,status:t.status}))))
