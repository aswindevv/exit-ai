import { svc } from './lib.mjs'
const db = svc()
const out={}
for (const t of ['analytics_insights','trend_alerts','agent_runs','exit_cases','exit_tasks','exit_interviews','compliance_checks','profiles','kt_reviews','case_documents']) {
  const { count } = await db.from(t).select('*', { count:'exact', head:true }); out[t]=count
}
console.log('COUNTS AFTER', JSON.stringify(out))
const { data } = await db.from('analytics_insights').select('id,agent_type,created_at').gte('created_at','2026-09-17T15:55:00Z').order('created_at')
console.log('analytics_insights rows appended by THIS track ('+data.length+'):')
for (const r of data) console.log('   ', r.created_at, r.agent_type, r.id)
const { data: ta } = await db.from('trend_alerts').select('id,theme,created_at').gte('created_at','2026-09-17T15:55:00Z')
console.log('trend_alerts appended by THIS track ('+ta.length+'):', JSON.stringify(ta))
