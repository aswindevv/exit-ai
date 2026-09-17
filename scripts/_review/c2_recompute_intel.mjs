import { svc } from './lib.mjs'
const db = svc()
const { data: iv } = await db.from('exit_interviews').select('case_id, themes')
const ids = iv.map(i=>i.case_id)
const { data: cs } = await db.from('exit_cases').select('id, department').in('id', ids)
const dept = Object.fromEntries(cs.map(c=>[c.id,c.department]))
const counts={}, depts={}
for (const i of iv) for (const t of (i.themes||[])) { counts[t]=(counts[t]||0)+1; (depts[t] ||= new Set()).add(dept[i.case_id]??null) }
const sev=n=> n>=4?'high': n>=3?'medium':'low'
const rising = Object.entries(counts).filter(([,n])=>n>=2).map(([t,n])=>({theme:t, department: depts[t].size===1?[...depts[t]][0]:null, count:n, severity:sev(n)}))
console.log('interviews:', iv.length, '| distinct themes:', Object.keys(counts).length)
console.log('ALL theme counts:', JSON.stringify(Object.fromEntries(Object.entries(counts).sort((a,b)=>b[1]-a[1]))))
console.log('INDEP rising (>=2):'); for(const r of rising.sort((a,b)=>b.count-a.count)) console.log('   ', JSON.stringify(r), 'depts seen=['+[...depts[r.theme]].join(',')+']')
const { data: ta } = await db.from('trend_alerts').select('theme, department, severity, detail')
console.log('EXISTING trend_alerts:', JSON.stringify(ta))
const key=r=>r.theme+'|'+(r.department??'NULL')
const have=new Set(ta.map(key))
console.log('PREDICTED new inserts:', JSON.stringify(rising.filter(r=>!have.has(key(r))).map(r=>({theme:r.theme,department:r.department,severity:r.severity,count:r.count}))))
console.log('PREDICTED dedupe-skipped:', JSON.stringify(rising.filter(r=>have.has(key(r))).map(r=>r.theme)))
// stale-severity check: existing rows whose severity no longer matches the current count
for (const t of ta) { const r = rising.find(x=>x.theme===t.theme && (x.department??null)===(t.department??null)); if (r && (r.severity!==t.severity || !t.detail.startsWith(r.count+' '))) console.log('   STALE existing row:', t.theme, 'stored sev='+t.severity, 'detail="'+t.detail+'" but current count='+r.count+' sev='+r.severity) }
