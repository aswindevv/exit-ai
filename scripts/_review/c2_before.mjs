import { svc } from './lib.mjs'
const db = svc()
const out = {}
for (const t of ['analytics_insights','trend_alerts','agent_runs','exit_cases','exit_tasks','exit_interviews','compliance_checks','profiles','kt_reviews','case_documents']) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true })
  out[t] = error ? 'ERR '+error.message : count
}
console.log('COUNTS BEFORE', JSON.stringify(out))
const { data: ai } = await db.from('analytics_insights').select('id, agent_type, created_at').order('created_at',{ascending:false}).limit(20)
console.log('latest analytics_insights:'); for (const r of ai||[]) console.log(' ', r.created_at, r.agent_type, r.id)
const { data: byType } = await db.from('analytics_insights').select('agent_type')
const c={}; for(const r of byType||[]) c[r.agent_type]=(c[r.agent_type]||0)+1
console.log('analytics_insights by agent_type BEFORE', JSON.stringify(c))
const { data: ta } = await db.from('trend_alerts').select('id, theme, department, severity, detail, created_at').order('created_at')
console.log('trend_alerts BEFORE ('+(ta||[]).length+'):'); for (const r of ta||[]) console.log('  ', JSON.stringify({theme:r.theme,department:r.department,severity:r.severity,detail:r.detail}))
