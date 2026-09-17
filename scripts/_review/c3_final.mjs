import { svc } from './lib.mjs'
const db = svc()
for (const t of ['exit_cases','exit_tasks','agent_runs','compliance_checks','case_documents','kt_reviews','exit_interviews','profiles']) {
  const { count } = await db.from(t).select('*', { count:'exact', head:true })
  console.log(t, count)
}
