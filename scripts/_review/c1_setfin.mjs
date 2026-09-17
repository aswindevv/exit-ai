import { svc, j } from './lib.mjs'
const CASE='36148438-4dc0-4741-a37f-d8ddc74713ad'
const db=svc()
const { data: c } = await db.from('exit_cases').select('employee_id').eq('id',CASE).single()
if (c.employee_id!=='Emp031') throw new Error('WRONG CASE')
const arg = process.argv[2]
if (arg==='dues') {
  const { data } = await db.from('exit_cases').update({finance_cleared:true, dues_note:'C1 review: dues settled'}).eq('id',CASE).select('finance_cleared,dues_note')
  console.log('finance_cleared ->', j(data))
} else if (arg==='allstages') {
  const { data } = await db.from('exit_tasks').update({status:'done'}).eq('case_id',CASE).neq('stage','finance').neq('stage','compliance').select('id,stage,title,status')
  console.log('marked done (non-finance/non-compliance):', data.length, j(data.map(r=>r.stage+': '+r.title)))
}
const { data: t } = await db.from('exit_tasks').select('stage,status,title').eq('case_id',CASE)
const by={}; for(const r of t){ by[r.stage]=by[r.stage]||{done:0,total:0}; by[r.stage].total++; if(r.status==='done')by[r.stage].done++ }
console.log('stage matrix:', j(by))
