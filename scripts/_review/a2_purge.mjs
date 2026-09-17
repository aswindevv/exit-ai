import { purgeCase, svc, casesFor, j } from './lib.mjs'
const db = svc()
const CID = 'ef93de5f-f688-4b41-ada1-204bea5f0e85'
console.log('cases for Emp021 before purge:', j(await casesFor('Emp021')))
console.log('purge result:', j(await purgeCase(CID, 'Emp021')))
console.log('cases for Emp021 after purge :', j(await casesFor('Emp021')))
// prove nothing of mine is left anywhere
for (const t of ['exit_tasks', 'agent_runs', 'compliance_checks', 'case_documents', 'kt_reviews', 'exit_interviews']) {
  const { data } = await db.from(t).select('id').eq('case_id', CID)
  console.log(`  leftover ${t}: ${(data || []).length}`)
}
const { data: marker } = await db.from('exit_tasks').select('id,title').ilike('title', '%A2%')
console.log('  any exit_tasks title containing "A2":', (marker || []).length)
const { data: n1 } = await db.from('exit_cases').select('id,dues_note').not('dues_note', 'is', null)
console.log('  cases with a non-null dues_note (checking for my markers):', j(n1))
// final counts
for (const t of ['exit_cases', 'exit_tasks', 'agent_runs', 'compliance_checks', 'case_documents', 'kt_reviews', 'exit_interviews', 'profiles', 'trend_alerts', 'analytics_insights']) {
  const { count } = await db.from(t).select('*', { count: 'exact', head: true })
  console.log(`  final count ${t.padEnd(20)} ${count}`)
}
