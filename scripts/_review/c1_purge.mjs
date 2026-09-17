import { svc, purgeCase, casesFor, j } from './lib.mjs'
const CASE='36148438-4dc0-4741-a37f-d8ddc74713ad'
const db=svc()
// storage first (purgeCase does not touch the bucket)
const { data: objs } = await db.storage.from('exit-documents').list(CASE)
const paths=(objs||[]).map(o=>`${CASE}/${o.name}`)
if (paths.length) { const { data, error } = await db.storage.from('exit-documents').remove(paths); console.log('storage removed:', error? 'ERR '+error.message : j(paths)) }
else console.log('storage: nothing to remove')
console.log('purgeCase ->', j(await purgeCase(CASE,'Emp031')))
console.log('casesFor(Emp031) ->', j(await casesFor('Emp031')))
const { data: left } = await db.storage.from('exit-documents').list(CASE)
console.log('storage left under case prefix:', j((left||[]).map(o=>o.name)))
const { data: siva } = await db.from('profiles').select('email,full_name,out_of_office').eq('email','siva@company.com').single()
console.log('SIVA restored ->', j(siva))
// protected-data sanity: global counts
for (const t of ['exit_cases','exit_tasks','agent_runs','compliance_checks','case_documents','kt_reviews','exit_interviews','profiles']) {
  const { count } = await db.from(t).select('*', { count:'exact', head:true })
  process.stdout.write(`${t}=${count} `)
}
console.log('')
// orphan check for my case id across children
for (const t of ['exit_tasks','agent_runs','compliance_checks','case_documents','kt_reviews','exit_interviews']) {
  const { count } = await db.from(t).select('*', { count:'exact', head:true }).eq('case_id',CASE)
  if (count) console.log('LEFTOVER', t, count)
}
console.log('leftover scan done')
