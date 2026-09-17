import { svc } from './lib.mjs'
const db = svc()
for (const t of ['policy_compliance_auditor','workflow_optimizer','predictive_attrition','dashboard_insights']) {
  const { data } = await db.from('analytics_insights').select('id,created_at,agent_type,stats,narrative').eq('agent_type',t).order('created_at',{ascending:false}).limit(1)
  const r = data[0]
  console.log('\n=== '+t+' latest: '+r.created_at+' id='+r.id)
  console.log('stats: '+JSON.stringify(r.stats).slice(0,700))
  console.log('narrative(first 200): '+r.narrative.slice(0,200).replace(/\n/g,' | '))
}
const { data: all } = await db.from('analytics_insights').select('agent_type')
const c={}; for(const r of all) c[r.agent_type]=(c[r.agent_type]||0)+1
console.log('\nanalytics_insights by agent_type NOW:', JSON.stringify(c), 'total', all.length)
