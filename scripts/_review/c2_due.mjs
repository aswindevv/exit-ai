import { svc } from './lib.mjs'
const db = svc()
const { data: tasks } = await db.from('exit_tasks').select('id, case_id, stage, title, status, due_date')
const pend = tasks.filter(t=>t.status==='pending')
const withDue = pend.filter(t=>t.due_date)
console.log('total tasks', tasks.length, '| pending', pend.length, '| pending WITH due_date', withDue.length, '| pending with NULL due_date', pend.length-withDue.length)
const today = new Date('2026-09-17T00:00:00Z')
const od = withDue.map(t=>({...t, d: Math.floor((today - new Date(t.due_date+'T00:00:00Z'))/86400000)}))
od.sort((a,b)=>b.d-a.d)
console.log('most-overdue pending tasks (days_overdue, negative = future):')
for (const t of od.slice(0,15)) console.log('   ', String(t.d).padStart(4), t.stage, '|', t.due_date, '|', t.title.slice(0,60))
console.log('breaches at >=5 days:', od.filter(t=>t.d>=5).length)
console.log('breaches at >=1 day:', od.filter(t=>t.d>=1).length)
const dd={}; for(const t of withDue) dd[t.due_date]=(dd[t.due_date]||0)+1
console.log('due_date distribution (pending):', JSON.stringify(Object.fromEntries(Object.entries(dd).sort())))
// all tasks including done
const allDue = tasks.filter(t=>t.due_date)
console.log('ALL tasks with a due_date:', allDue.length, 'of', tasks.length)
