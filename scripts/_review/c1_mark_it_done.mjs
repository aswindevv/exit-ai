import { svc, j } from './lib.mjs'
const CASE='36148438-4dc0-4741-a37f-d8ddc74713ad'
const db=svc()
const { data: before } = await db.from('exit_cases').select('employee_id').eq('id',CASE).single()
if (before.employee_id!=='Emp031') throw new Error('WRONG CASE')
const { data } = await db.from('exit_tasks').update({status:'done'}).eq('case_id',CASE).eq('stage','it').select('id,title,status')
console.log('marked done:', j(data))
