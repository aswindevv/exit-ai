import { anonAs, svc, ACCOUNTS, employee, j } from './lib.mjs'
import { createClient } from '@supabase/supabase-js'
const db = svc()
const CID = process.argv[2]
if (!CID) { console.log('need case id'); process.exit(1) }

console.log('===== A. CURRENT disposable case row (after the anon rpc call in a2_write) =====')
const { data: row } = await db.from('exit_cases').select('id,employee_id,finance_cleared,finance_rejected,dues_note').eq('id', CID).single()
console.log(j(row))
console.log('  -> dues_note === "anon probe" ?', row.dues_note === 'anon probe', '  (a2_write left it as "A2 probe" before the anon call)')

console.log('\n===== B. anon (no sign-in) direct RPC replay, with a distinct marker =====')
const anonRaw = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const r1 = await anonRaw.rpc('finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'ANON-BYPASS-MARKER-1' })
console.log('  anon finance_mark_dues_settled ->', r1.error ? 'ERR ' + r1.error.message : 'no error')
const { data: a1 } = await db.from('exit_cases').select('finance_cleared,finance_rejected,dues_note').eq('id', CID).single()
console.log('  row now:', j(a1))
const r2 = await anonRaw.rpc('finance_reject_dues', { p_case_id: CID, p_reason: 'ANON-BYPASS-MARKER-2' })
console.log('  anon finance_reject_dues ->', r2.error ? 'ERR ' + r2.error.message : 'no error')
const { data: a2 } = await db.from('exit_cases').select('finance_cleared,finance_rejected,dues_note').eq('id', CID).single()
console.log('  row now:', j(a2))
const r3 = await anonRaw.rpc('app_current_role', {})
console.log('  anon app_current_role ->', r3.error ? 'ERR ' + r3.error.message : JSON.stringify(r3.data), ' (NULL is why the <> comparison never fires)')
const r4 = await anonRaw.rpc('owns_exit_case', { p_case_id: CID })
console.log('  anon owns_exit_case ->', r4.error ? 'ERR ' + r4.error.message : JSON.stringify(r4.data))
const r5 = await anonRaw.rpc('exit_case_cleared_for_relieving', { p_case_id: CID })
console.log('  anon exit_case_cleared_for_relieving ->', r5.error ? 'ERR ' + r5.error.message : JSON.stringify(r5.data))
const r6 = await anonRaw.rpc('match_exit_docs', { query_embedding: new Array(1536).fill(0), match_count: 3 })
console.log('  anon match_exit_docs ->', r6.error ? 'ERR ' + r6.error.message : 'rows=' + (r6.data || []).length)

console.log('\n===== C. can a SIGNED-IN employee reach the same RPC? (already shown DENY) vs anon =====')
const emp = (await anonAs(employee('Emp021').email, employee('Emp021').password)).client
const e1 = await emp.rpc('finance_mark_dues_settled', { p_case_id: CID, p_dues_note: 'x' })
console.log('  employee ->', e1.error ? 'ERR ' + e1.error.message : 'SUCCEEDED')

console.log('\n===== D. exit_tasks column-grant drill: which columns can each role rewrite? =====')
const { data: tks } = await db.from('exit_tasks').select('id,stage,status,title,due_date,reason,escalation_state').eq('case_id', CID)
const T = Object.fromEntries(tks.map(t => [t.stage, t.id]))
console.log('before:', j(tks.map(t => ({ s: t.stage, st: t.status, title: t.title, due: t.due_date, reason: t.reason, esc: t.escalation_state }))))

const C = {
  emp021: (await anonAs(employee('Emp021').email, employee('Emp021').password)).client,
  manager: (await anonAs(ACCOUNTS.manager.email, ACCOUNTS.manager.password)).client,
  it: (await anonAs(ACCOUNTS.it.email, ACCOUNTS.it.password)).client,
}
async function tryCol(role, taskStage, patch) {
  const r = await C[role].from('exit_tasks').update(patch).eq('id', T[taskStage]).select('id')
  const n = r.data ? r.data.length : 0
  console.log(`  ${role.padEnd(8)} ${taskStage.padEnd(9)} ${JSON.stringify(patch).padEnd(56)} -> ${n ? 'WROTE' : 'denied'} ${r.error ? 'ERR ' + r.error.message : ''}`)
}
// employee owns the hr-stage row; WITH CHECK pins status='done' so include it where needed
await tryCol('emp021', 'hr', { title: 'A2-TITLE-REWRITE', status: 'done' })
await tryCol('emp021', 'hr', { due_date: '2030-01-01', status: 'done' })
await tryCol('emp021', 'hr', { reason: 'A2-REASON-REWRITE', status: 'done' })
await tryCol('emp021', 'hr', { escalation_state: 'resolved', status: 'done' })
await tryCol('emp021', 'hr', { created_at: '2000-01-01T00:00:00Z', status: 'done' })
await tryCol('emp021', 'hr', { kt_event_id: 'A2-FAKE-EVENT', status: 'done' })
await tryCol('emp021', 'hr', { stage: 'it', status: 'done' })
await tryCol('emp021', 'hr', { case_id: '00000000-0000-0000-0000-000000000000', status: 'done' })
await tryCol('manager', 'manager', { title: 'A2-MGR-TITLE-REWRITE', status: 'done' })
await tryCol('manager', 'manager', { escalation_state: 'resolved', status: 'done' })
await tryCol('it', 'it', { title: 'A2-IT-TITLE-REWRITE', status: 'done' })
await tryCol('it', 'it', { due_date: '2030-01-01', status: 'done' })

const { data: tks2 } = await db.from('exit_tasks').select('stage,status,title,due_date,reason,escalation_state,kt_event_id,created_at').eq('case_id', CID).order('stage')
console.log('after:', j(tks2))

console.log('\n===== E. profiles write surface =====')
const p1 = await C.emp021.from('profiles').update({ full_name: 'A2-NAME-REWRITE' }).eq('email', 'emp021@gmail.com').select('id,full_name')
console.log('  employee rewrite own full_name ->', p1.data && p1.data.length ? 'WROTE ' + j(p1.data) : 'denied', p1.error ? 'ERR ' + p1.error.message : '')
const p2 = await C.emp021.from('profiles').update({ out_of_office: true }).eq('email', 'emp021@gmail.com').select('id')
console.log('  employee set own out_of_office ->', p2.data && p2.data.length ? 'WROTE' : 'denied', p2.error ? 'ERR ' + p2.error.message : '')
const p3 = await C.emp021.from('profiles').select('*').eq('email', 'aravidhan@company.com')
console.log('  employee read manager profile rows=', p3.data ? p3.data.length : 0)
