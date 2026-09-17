import { anonAs, ACCOUNTS } from './lib.mjs'
const { client } = await anonAs(ACCOUNTS.hr.email, ACCOUNTS.hr.password)
for (const t of ['policy_compliance_auditor','dashboard_insights','workflow_optimizer','predictive_attrition']) {
  const { data, error } = await client.from('analytics_insights').select('id,created_at,agent_type').eq('agent_type',t).order('created_at',{ascending:false}).limit(1)
  console.log('HR(anon+RLS) reads '+t+':', error? 'ERR '+error.message : (data.length? 'OK '+data[0].created_at+' '+data[0].id : 'ZERO ROWS'))
}
const { data: ta, error: te } = await client.from('trend_alerts').select('*')
console.log('HR(anon+RLS) reads trend_alerts:', te? 'ERR '+te.message : ta.length+' rows')
// non-HR roles must not read HR analytics
import { anonAs as a2 } from './lib.mjs'
for (const [role, acct] of Object.entries(ACCOUNTS)) {
  if (role==='hr') continue
  const { client: c } = await a2(acct.email, acct.password)
  const { data, error } = await c.from('analytics_insights').select('id').limit(5)
  console.log('  '+role+' reads analytics_insights:', error? 'BLOCKED('+error.message+')' : data.length+' rows')
  const { data: d2, error: e2 } = await c.from('trend_alerts').select('id').limit(5)
  console.log('  '+role+' reads trend_alerts:', e2? 'BLOCKED('+e2.message+')' : d2.length+' rows')
}
