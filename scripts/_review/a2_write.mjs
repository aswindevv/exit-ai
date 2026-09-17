import { anonAs, svc, ACCOUNTS, employee, purgeCase, j } from './lib.mjs'
import { createClient } from '@supabase/supabase-js'
const db = svc()
const AR = '7a43e75e-7b0e-46ad-8d6e-f278e9b3f81e', SIVA = '24774c6e-bf6b-430f-8ba6-621fe8a5c78c'

// ---------- disposable case on Emp021 (NOT protected, had 0 cases) ----------
const pre = await db.from('exit_cases').select('id').eq('employee_id', 'Emp021')
if (pre.data.length) { console.log('ABORT: Emp021 already has a case', j(pre.data)); process.exit(1) }
const { data: dc, error: dcErr } = await db.from('exit_cases').insert({
  employee_id: 'Emp021', employee_name: 'Aiden Nair', email: 'emp021@gmail.com',
  department: 'Engineering', role_title: 'Software Engineer',
  manager_id: AR, hr_id: SIVA, last_working_day: '2026-12-31', status: 'open',
  risk_level: 'high', risk_score: 0.99, rehire_eligible: false,
}).select('*').single()
if (dcErr) { console.log('create fail', dcErr.message); process.exit(1) }
const CID = dc.id
console.log('DISPOSABLE CASE', CID, 'for Emp021')
const stages = ['hr', 'manager', 'it', 'finance', 'compliance']
const { data: dt } = await db.from('exit_tasks').insert(stages.map(s => ({
  case_id: CID, stage: s, title: `[A2 review disposable] ${s} task`, status: 'pending', due_date: '2026-12-31',
}))).select('id,stage')
const T = Object.fromEntries(dt.map(t => [t.stage, t.id]))
console.log('tasks', j(T))

const C = {}
for (const [k, a] of Object.entries({
  hr: ACCOUNTS.hr, manager: ACCOUNTS.manager, it: ACCOUNTS.it, finance: ACCOUNTS.finance,
  emp021: employee('Emp021'), emp022: employee('Emp022'),
})) C[k] = (await anonAs(a.email, a.password)).client

const results = []
async function T_(name, expect, fn) {
  let out
  try { out = await fn() } catch (e) { out = { error: { message: String(e.message || e) } } }
  const rows = out && out.data ? (Array.isArray(out.data) ? out.data.length : 1) : 0
  const err = out && out.error ? `${out.error.code || ''} ${out.error.message}`.trim() : null
  const denied = rows === 0
  const ok = expect === 'DENY' ? denied : !denied
  results.push({ name, expect, rows, err, verdict: ok ? 'OK' : 'VIOLATION' })
  console.log(`${ok ? '  OK  ' : '!!VIOL'} [${expect}] ${name.padEnd(62)} rows=${rows} ${err ? 'ERR: ' + err : ''}`)
  return out
}

console.log('\n===== exit_tasks UPDATE boundary (disposable case only) =====')
await T_('employee(own) hr-stage -> done  [positive control]', 'ALLOW', () => C.emp021.from('exit_tasks').update({ status: 'done' }).eq('id', T.hr).select('id,status'))
await T_('employee(own) hr-stage -> pending (un-approve)', 'DENY', () => C.emp021.from('exit_tasks').update({ status: 'pending' }).eq('id', T.hr).select('id,status'))
await T_('employee(own) manager-stage -> done (wrong stage)', 'DENY', () => C.emp021.from('exit_tasks').update({ status: 'done' }).eq('id', T.manager).select('id,status'))
await T_('employee(own) it-stage -> done (wrong stage)', 'DENY', () => C.emp021.from('exit_tasks').update({ status: 'done' }).eq('id', T.it).select('id,status'))
await T_('employee(own) rewrite title (column grant)', 'DENY', () => C.emp021.from('exit_tasks').update({ title: 'HACKED' }).eq('id', T.hr).select('id,title'))
await T_('employee cross-case: Emp022 -> Emp021 hr task', 'DENY', () => C.emp022.from('exit_tasks').update({ status: 'done' }).eq('id', T.hr).select('id,status'))
await T_('manager manager-stage -> done  [positive control]', 'ALLOW', () => C.manager.from('exit_tasks').update({ status: 'done' }).eq('id', T.manager).select('id,status'))
await T_('manager it-stage -> done (out of scope)', 'DENY', () => C.manager.from('exit_tasks').update({ status: 'done' }).eq('id', T.it).select('id,status'))
await T_('manager hr-stage -> done (out of scope)', 'DENY', () => C.manager.from('exit_tasks').update({ status: 'done' }).eq('id', T.hr).select('id,status'))
await T_('manager compliance-stage -> done (out of scope)', 'DENY', () => C.manager.from('exit_tasks').update({ status: 'done' }).eq('id', T.compliance).select('id,status'))
await T_('it it-stage -> done  [positive control]', 'ALLOW', () => C.it.from('exit_tasks').update({ status: 'done' }).eq('id', T.it).select('id,status'))
await T_('it manager-stage -> done (out of scope)', 'DENY', () => C.it.from('exit_tasks').update({ status: 'done' }).eq('id', T.manager).select('id,status'))
await T_('finance finance-stage -> done (finance has NO update policy)', 'DENY', () => C.finance.from('exit_tasks').update({ status: 'done' }).eq('id', T.finance).select('id,status'))
await T_('hr compliance-stage -> done (hr has NO exit_tasks update policy)', 'DENY', () => C.hr.from('exit_tasks').update({ status: 'done' }).eq('id', T.compliance).select('id,status'))
await T_('employee DELETE own task', 'DENY', () => C.emp021.from('exit_tasks').delete().eq('id', T.hr).select('id'))
await T_('employee INSERT new task on own case', 'DENY', () => C.emp021.from('exit_tasks').insert({ case_id: CID, stage: 'hr', title: 'x', status: 'pending' }).select('id'))

console.log('\n===== exit_cases UPDATE boundary =====')
await T_('manager set finance_cleared=true', 'DENY', () => C.manager.from('exit_cases').update({ finance_cleared: true }).eq('id', CID).select('id'))
await T_('manager set risk_level=low', 'DENY', () => C.manager.from('exit_cases').update({ risk_level: 'low' }).eq('id', CID).select('id'))
await T_('employee set risk_level=low', 'DENY', () => C.emp021.from('exit_cases').update({ risk_level: 'low' }).eq('id', CID).select('id'))
await T_('employee set status=completed', 'DENY', () => C.emp021.from('exit_cases').update({ status: 'completed' }).eq('id', CID).select('id'))
await T_('it set finance_cleared=true', 'DENY', () => C.it.from('exit_cases').update({ finance_cleared: true }).eq('id', CID).select('id'))
await T_('finance set finance_cleared=true direct (0014 revoked grant)', 'DENY', () => C.finance.from('exit_cases').update({ finance_cleared: true }).eq('id', CID).select('id'))
await T_('manager issue relieving letter', 'DENY', () => C.manager.from('exit_cases').update({ relieving_letter_issued: true, status: 'completed' }).eq('id', CID).select('id'))
await T_('employee INSERT exit_cases (self-serve case creation)', 'DENY', () => C.emp021.from('exit_cases').insert({ employee_id: 'Emp021', employee_name: 'x', email: 'x@x.com', department: 'd', role_title: 'r', last_working_day: '2026-12-31' }).select('id'))
await T_('employee DELETE own case', 'DENY', () => C.emp021.from('exit_cases').delete().eq('id', CID).select('id'))
await T_('hr issue relieving letter on NOT-cleared case (RPC gate)', 'DENY', () => C.hr.from('exit_cases').update({ relieving_letter_issued: true, issued_by: SIVA, status: 'completed' }).eq('id', CID).select('id'))

console.log('\n===== inserts into HR-only tables =====')
const { data: otherInt } = await db.from('exit_interviews').select('case_id').limit(1)
await T_('employee INSERT interview on ANOTHER case', 'DENY', () => C.emp021.from('exit_interviews').insert({ case_id: otherInt[0].case_id, reason_for_leaving: 'A2 probe', feedback: 'x' }).select('case_id'))
await T_('employee INSERT interview WITH summary/sentiment on OWN case', 'DENY', () => C.emp021.from('exit_interviews').insert({ case_id: CID, summary: 'A2 probe', sentiment: 'positive' }).select('case_id'))
await T_('manager INSERT interview on own report case', 'DENY', () => C.manager.from('exit_interviews').insert({ case_id: CID, reason_for_leaving: 'A2 probe' }).select('case_id'))
await T_('employee INSERT trend_alerts', 'DENY', () => C.emp021.from('trend_alerts').insert({ theme: 'x', department: 'd', severity: 'low', detail: 'A2 probe' }).select('id'))
await T_('employee INSERT agent_runs', 'DENY', () => C.emp021.from('agent_runs').insert({ case_id: CID, stage: 'hr', detail: 'A2 probe' }).select('id'))
await T_('employee INSERT exit_docs', 'DENY', () => C.emp021.from('exit_docs').insert({ content: 'A2 probe' }).select('id'))
await T_('employee INSERT case_documents on ANOTHER case', 'DENY', () => C.emp022.from('case_documents').insert({ case_id: CID, doc_type: 'nda', file_path: 'x' }).select('id'))
await T_('employee UPDATE own profiles.role -> hr (priv-esc)', 'DENY', () => C.emp021.from('profiles').update({ role: 'hr' }).eq('email', 'emp021@gmail.com').select('id,role'))

console.log('\n===== RPC boundary =====')
async function R(name, expect, client, fn, args) {
  const { data, error } = await client.rpc(fn, args)
  const denied = !!error
  const ok = expect === 'DENY' ? denied : !denied
  results.push({ name, expect, rows: denied ? 0 : 1, err: error ? error.message : null, verdict: ok ? 'OK' : 'VIOLATION' })
  console.log(`${ok ? '  OK  ' : '!!VIOL'} [${expect}] ${name.padEnd(62)} ${error ? 'ERR: ' + error.message : 'returned ' + JSON.stringify(data)}`)
}
await R('manager  -> finance_mark_dues_settled (disposable)', 'DENY', C.manager, 'finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'A2 probe' })
await R('employee -> finance_mark_dues_settled (disposable)', 'DENY', C.emp021, 'finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'A2 probe' })
await R('it       -> finance_mark_dues_settled (disposable)', 'DENY', C.it, 'finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'A2 probe' })
await R('hr       -> finance_mark_dues_settled (disposable)', 'DENY', C.hr, 'finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'A2 probe' })
await R('manager  -> finance_reject_dues (disposable)', 'DENY', C.manager, 'finance_reject_dues', { p_case_id: CID, p_reason: 'A2 probe' })
await R('finance  -> finance_mark_dues_settled (disposable) [control]', 'ALLOW', C.finance, 'finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'A2 probe' })
await R('employee -> app_current_role()', 'ALLOW', C.emp021, 'app_current_role', {})
await R('employee -> owns_exit_case(ANOTHER case)', 'ALLOW', C.emp021, 'owns_exit_case', { p_case_id: otherInt[0].case_id })
await R('manager  -> exit_case_cleared_for_relieving(disposable)', 'ALLOW', C.manager, 'exit_case_cleared_for_relieving', { p_case_id: CID })

console.log('\n===== disposable case state after all attempts =====')
const { data: after } = await db.from('exit_cases').select('*').eq('id', CID).single()
console.log(j({ finance_cleared: after.finance_cleared, dues_note: after.dues_note, risk_level: after.risk_level, status: after.status, relieving_letter_issued: after.relieving_letter_issued }))
const { data: afterT } = await db.from('exit_tasks').select('stage,status,title').eq('case_id', CID).order('stage')
console.log(j(afterT))

console.log('\n===== ANON (never signed in) =====')
const anonRaw = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
for (const t of ['exit_cases', 'exit_tasks', 'exit_interviews', 'profiles', 'exit_docs', 'agent_runs', 'trend_alerts']) {
  const r = await anonRaw.from(t).select('*')
  console.log(`  anon ${t.padEnd(20)} rows=${r.data ? r.data.length : 0} ${r.error ? 'ERR ' + r.error.message : ''}`)
}
for (const v of ['employee_exit_view', 'manager_case_view', 'it_task_view', 'finance_case_view', 'employee_interview_status_view']) {
  const r = await anonRaw.from(v).select('*')
  console.log(`  anon ${v.padEnd(20)} rows=${r.data ? r.data.length : 0} ${r.error ? 'ERR ' + r.error.message : ''}`)
}
const rr = await anonRaw.rpc('finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'anon probe' })
console.log('  anon rpc finance_mark_dues_settled:', rr.error ? ('ERR ' + rr.error.message) : 'SUCCEEDED (!!)')

console.log('\n===== SUMMARY =====')
const viol = results.filter(r => r.verdict === 'VIOLATION')
console.log(`${results.length} boundary probes, ${viol.length} VIOLATIONS`)
viol.forEach(v => console.log('  VIOLATION:', j(v)))
console.log('__CID__=' + CID)
