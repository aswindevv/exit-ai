import { anonAs, svc, ACCOUNTS, employee, j } from './lib.mjs'
import { createClient } from '@supabase/supabase-js'
const db = svc()

const C = {
  manager: (await anonAs(ACCOUNTS.manager.email, ACCOUNTS.manager.password)).client,
  it: (await anonAs(ACCOUNTS.it.email, ACCOUNTS.it.password)).client,
  finance: (await anonAs(ACCOUNTS.finance.email, ACCOUNTS.finance.password)).client,
  emp022: (await anonAs(employee('Emp022').email, employee('Emp022').password)).client,
  emp021: (await anonAs(employee('Emp021').email, employee('Emp021').password)).client,
}

console.log('===== F. PostgREST resource embedding — can a non-HR role pull risk through a join? =====')
const embeds = [
  ['exit_tasks?select=id,stage,exit_cases(risk_level,risk_score,rehire_eligible)', c => c.from('exit_tasks').select('id,stage,exit_cases(risk_level,risk_score,rehire_eligible)').limit(3)],
  ['exit_tasks?select=id,exit_cases(*)', c => c.from('exit_tasks').select('id,exit_cases(*)').limit(3)],
  ['kt_reviews?select=*,exit_cases(risk_level)', c => c.from('kt_reviews').select('*,exit_cases(risk_level)').limit(3)],
  ['case_documents?select=*,exit_cases(risk_level)', c => c.from('case_documents').select('*,exit_cases(risk_level)').limit(3)],
  ['compliance_checks?select=*,exit_cases(risk_level)', c => c.from('compliance_checks').select('*,exit_cases(risk_level)').limit(3)],
  ['exit_interviews?select=summary,exit_cases(employee_name)', c => c.from('exit_interviews').select('summary,exit_cases(employee_name)').limit(3)],
]
for (const [label, fn] of embeds) {
  for (const [k, c] of Object.entries(C)) {
    const r = await fn(c)
    const n = r.data ? r.data.length : 0
    let leak = 'n/a'
    if (n) {
      const s = JSON.stringify(r.data)
      leak = /"risk_level":"(low|medium|high)"|"risk_score":[0-9]|"rehire_eligible":(true|false)|"summary":"[^"]/.test(s) ? 'LEAK!! ' + s.slice(0, 240) : 'no assessment values (' + JSON.stringify(r.data[0]).slice(0, 140) + ')'
    }
    console.log(`  ${k.padEnd(8)} ${label.padEnd(62)} rows=${String(n).padEnd(4)} ${r.error ? 'ERR ' + r.error.message : leak}`)
  }
  console.log('')
}

console.log('===== G. filter-based inference: can a non-HR role probe risk via a WHERE clause on a view? =====')
for (const [k, c] of Object.entries(C)) {
  const r = await c.from('manager_case_view').select('id').eq('risk_level', 'high')
  console.log(`  ${k.padEnd(8)} manager_case_view?risk_level=eq.high -> rows=${r.data ? r.data.length : 0} ${r.error ? 'ERR ' + r.error.message : ''}`)
}
for (const [k, c] of Object.entries(C)) {
  const r = await c.from('finance_case_view').select('id').eq('risk_score', 0.686)
  console.log(`  ${k.padEnd(8)} finance_case_view?risk_score=eq.0.686 -> rows=${r.data ? r.data.length : 0} ${r.error ? 'ERR ' + r.error.message : ''}`)
}
for (const [k, c] of Object.entries(C)) {
  const r = await c.from('exit_cases').select('id').eq('risk_level', 'high')
  console.log(`  ${k.padEnd(8)} exit_cases?risk_level=eq.high -> rows=${r.data ? r.data.length : 0} ${r.error ? 'ERR ' + r.error.message : ''}`)
}

console.log('\n===== H. storage: exit-documents bucket cross-tenant read =====')
const { data: docs } = await db.from('case_documents').select('case_id,file_path').limit(6)
console.log('  svc sample file_paths:', j(docs))
const buckets = ['exit-documents', 'exit_documents']
for (const b of buckets) {
  for (const [k, c] of Object.entries({ emp021: C.emp021, manager: C.manager, it: C.it })) {
    const r = await c.storage.from(b).list('', { limit: 5 })
    console.log(`  ${k.padEnd(8)} storage.list('${b}') -> ${r.error ? 'ERR ' + r.error.message : 'entries=' + (r.data || []).length + ' ' + JSON.stringify((r.data || []).map(x => x.name))}`)
  }
}
if (docs && docs.length) {
  const p = docs[0].file_path
  for (const b of buckets) {
    const r = await C.emp021.storage.from(b).download(p)
    console.log(`  emp021 download('${b}','${p}') -> ${r.error ? 'ERR ' + r.error.message : 'GOT ' + (r.data ? r.data.size : '?') + ' bytes (LEAK)'}`)
  }
}
