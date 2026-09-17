import { svc } from './lib.mjs'
const db = svc()
const { data: cases } = await db.from('exit_cases').select('employee_id, department, risk_score')
const { data: alerts } = await db.from('trend_alerts').select('department, severity, theme')
const { data: emps } = await db.from('profiles').select('employee_id, full_name, department, role').eq('role','employee')
const byDept = {}
for (const c of cases) if (c.department && c.risk_score!==null && c.risk_score!==undefined) (byDept[c.department] ||= []).push(c.risk_score)
console.log('per-department risk_score samples / avg (HIGH_RISK_AVG=0.6):')
const flagged=[]
for (const d of Object.keys(byDept).sort()) {
  const s=byDept[d]; const avg=s.reduce((a,b)=>a+b,0)/s.length
  const hit = avg>=0.6
  if (hit) flagged.push(d)
  console.log('  ', d.padEnd(12), 'n='+s.length, 'scores=['+s.join(', ')+']', 'avg='+(Math.round(avg*100)/100), hit?'<== FLAGGED':'')
}
console.log('INDEP flagged departments:', JSON.stringify(flagged.sort()))
console.log('alert-derived departments (severity!=low, dept non-null):', JSON.stringify([...new Set(alerts.filter(a=>a.department&&a.severity!=='low').map(a=>a.department))]))
console.log('trend_alerts departments seen:', JSON.stringify(alerts.map(a=>a.department)))
const atRisk = emps.filter(e=>flagged.includes(e.department))
console.log('INDEP at_risk_employee_count:', atRisk.length, '| total role=employee profiles:', emps.length)
// how many of the "at-risk" already have an exit case
const caseEmp = new Set(cases.map(c=>c.employee_id))
const already = atRisk.filter(e=>caseEmp.has(e.employee_id))
console.log('of those at-risk, ALREADY have an exit case (i.e. already leaving):', already.length, JSON.stringify(already.map(e=>e.employee_id)))
// cases with NULL risk_score excluded from the average
console.log('cases with NULL risk_score excluded from the averages:', cases.filter(c=>c.risk_score===null).length, 'of', cases.length)
