// Drill-down on the offenders found by t2_integrity.mjs. READ-ONLY.
import { svc } from './lib.mjs'
const db = svc()
const ids = {
  Emp015: '3582dd2c-9bd7-4978-b57b-e7df5487b669',
  Emp007: '1ad3b86f-f2e7-42c3-9d10-958eb091aca1',
  Emp019: '40c9690c-8df9-4738-9959-d7344ff6236d',
  Emp006: '13eaa5fe-6abf-495a-9074-f19348bce038',
  Emp011: '13c4004b-eb22-4962-b411-efd32f0789b1',
  Emp013: '28b4a3c1-ddb3-4984-ae3b-72f4440f8a0b',
  Emp052: '0d2c813d-b373-4b32-a70b-46fb5d9aabf0',
  Emp002: 'dca02f2d-b0ed-4f3a-ac6b-b14dd755eb77',
  Emp010: '56d0202a-7761-4331-ae22-6dff011d45fc',
}
for (const [emp, id] of Object.entries(ids)) {
  console.log('\n' + '='.repeat(90))
  const { data: c } = await db.from('exit_cases').select('*').eq('id', id).single()
  console.log(`${emp} ${c.employee_name} status=${c.status} finance_cleared=${c.finance_cleared} relieving=${c.relieving_letter_issued} risk=${c.risk_level}/${c.risk_score} created=${c.created_at}`)
  const { data: ts } = await db.from('exit_tasks').select('stage,status,title,escalation_state,created_at').eq('case_id', id).order('created_at')
  for (const t of ts) console.log(`   [${t.stage.padEnd(10)}] ${t.status.padEnd(7)} ${t.escalation_state ? '(' + t.escalation_state + ') ' : ''}${t.title}`)
  const { data: runs } = await db.from('agent_runs').select('agent,stage,status,detail,created_at').eq('case_id', id).order('created_at')
  console.log('   -- agent_runs:')
  for (const r of (runs || [])) console.log(`      ${r.created_at.slice(0, 19)} ${String(r.agent || r.stage).padEnd(18)} ${String(r.status || '-').padEnd(9)} ${String(r.detail).slice(0, 110)}`)
}

// which employee_exit_view / manager_case_view rows exist for the zero-task cases
console.log('\n' + '='.repeat(90))
console.log('ROLE-VIEW VISIBILITY OF ZERO-TASK CASES')
for (const v of ['employee_exit_view', 'manager_case_view', 'finance_case_view']) {
  for (const [emp, id] of [['Emp013', ids.Emp013], ['Emp052', ids.Emp052]]) {
    const { data, error } = await db.from(v).select('*').eq('case_id', id)
    const alt = error ? await db.from(v).select('*').eq('id', id) : null
    const rows = data && data.length ? data : (alt?.data || [])
    console.log(`${v.padEnd(20)} ${emp}: ${rows.length} row(s) ${rows[0] ? JSON.stringify(rows[0]).slice(0, 200) : (error ? 'err=' + error.message : '')}`)
  }
}
