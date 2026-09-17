import { svc } from './lib.mjs'
const db = svc()
const { data } = await db.from('analytics_insights').select('*').eq('agent_type','dashboard_insights').order('created_at',{ascending:false}).limit(1)
const r = data[0]
console.log('PERSISTED id='+r.id+' created='+r.created_at+' agent_type='+r.agent_type)
console.log('PERSISTED_STATS ' + JSON.stringify(r.stats))
console.log('columns present: ' + Object.keys(r).join(','))
console.log('NARRATIVE: ' + r.narrative)
