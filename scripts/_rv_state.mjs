// Read-only pre-review state snapshot. Service key (bypasses RLS) — reporting only.
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile()
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const { data: cases } = await db
  .from('exit_cases')
  .select('id, employee_id, employee_name, department, status, finance_cleared, finance_rejected, relieving_letter_issued, risk_level, last_working_day, created_at')
  .order('employee_id')

console.log('=== exit_cases (' + cases.length + ') ===')
for (const c of cases) {
  console.log(
    [
      c.employee_id.padEnd(7),
      c.id.slice(0, 8),
      (c.employee_name || '').slice(0, 18).padEnd(18),
      (c.department || '').slice(0, 12).padEnd(12),
      c.status.padEnd(12),
      'fin=' + (c.finance_cleared ? 'Y' : 'n') + (c.finance_rejected ? '/REJ' : ''),
      'rel=' + (c.relieving_letter_issued ? 'Y' : 'n'),
      'risk=' + (c.risk_level || '-'),
      'lwd=' + c.last_working_day,
    ].join('  '),
  )
}

const { data: profs } = await db.from('profiles').select('employee_id, email, full_name, department, role, out_of_office').order('employee_id')
const emps = profs.filter((p) => p.role === 'employee')
const withCase = new Set(cases.map((c) => c.employee_id))
const free = emps.filter((p) => !withCase.has(p.employee_id)).map((p) => p.employee_id)
console.log('\n=== employees WITHOUT a case (usable as disposable), first 25 ===')
console.log(free.slice(0, 25).join(', '), '| total free:', free.length)
console.log('sample employee row:', JSON.stringify(emps.find((e) => e.employee_id === free[0])))

console.log('\n=== staff profiles ===')
for (const p of profs.filter((x) => x.role !== 'employee')) {
  console.log(p.role.padEnd(9), (p.full_name || '').padEnd(20), p.email.padEnd(32), 'dept=' + p.department, 'ooo=' + p.out_of_office)
}

// tasks per case by stage
const { data: tasks } = await db.from('exit_tasks').select('case_id, stage, status, escalation_state')
const byCase = {}
for (const t of tasks) {
  byCase[t.case_id] ??= {}
  byCase[t.case_id][t.stage] ??= { done: 0, pending: 0 }
  byCase[t.case_id][t.stage][t.status]++
}
console.log('\n=== tasks by case/stage (emp -> stage:done/total) ===')
for (const c of cases) {
  const s = byCase[c.id] || {}
  const parts = Object.entries(s).map(([st, v]) => `${st}:${v.done}/${v.done + v.pending}`)
  console.log(c.employee_id.padEnd(7), c.status.padEnd(12), parts.join(' '))
}
const esc = tasks.filter((t) => t.escalation_state)
console.log('\nescalation rows:', JSON.stringify(esc.reduce((a, t) => ((a[t.escalation_state] = (a[t.escalation_state] || 0) + 1), a), {})))
