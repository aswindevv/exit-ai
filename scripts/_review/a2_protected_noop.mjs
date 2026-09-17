import { anonAs, svc, ACCOUNTS, j } from './lib.mjs'
const db = svc()
// Task step 10c: as finance, call finance_mark_dues_settled on a PROTECTED case
// that is ALREADY finance_cleared=true so the write is a byte no-op.
// Emp001: finance_cleared=true, finance_rejected=false, dues_note=null.
// We pass p_dues_note=null so all three assigned columns keep their exact values.
const { data: before } = await db.from('exit_cases').select('*').eq('employee_id', 'Emp001').single()
console.log('BEFORE (full row):', j(before))
if (before.finance_cleared !== true || before.finance_rejected !== false || before.dues_note !== null) {
  console.log('ABORT: Emp001 is not in the exact no-op state; refusing to call the RPC.')
  process.exit(1)
}
const { client: fin } = await anonAs(ACCOUNTS.finance.email, ACCOUNTS.finance.password)
const { data, error } = await fin.rpc('finance_mark_dues_settled', { p_case_id: before.id, p_dues_note: null })
console.log('\nfinance -> finance_mark_dues_settled(Emp001 case, null) :', error ? 'ERR ' + error.message : 'ALLOWED (returned ' + JSON.stringify(data) + ')')
console.log('  => finance can clear ANY case by id; the RPC has no ownership/assignment scoping at all.')
const { data: after } = await db.from('exit_cases').select('*').eq('employee_id', 'Emp001').single()
const same = JSON.stringify(before) === JSON.stringify(after)
console.log('\nAFTER (full row) byte-identical to BEFORE:', same)
if (!same) {
  console.log('DIFF:', j(Object.fromEntries(Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => [k, [before[k], after[k]]]))))
}
console.log(j(after))
