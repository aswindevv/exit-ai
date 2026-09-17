import { svc } from './lib.mjs'
const { data } = await svc().from('trend_alerts').select('id, theme, department, severity, detail, created_at').order('created_at')
console.log('trend_alerts NOW ('+data.length+'):')
for (const r of data) console.log('  ', r.created_at, '|', JSON.stringify({theme:r.theme,department:r.department,severity:r.severity,detail:r.detail}))
