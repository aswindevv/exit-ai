import { anonAs, svc, ACCOUNTS, employee, j } from './lib.mjs'

const ROLES = {
  hr:       { ...ACCOUNTS.hr },
  manager:  { ...ACCOUNTS.manager },
  it:       { ...ACCOUNTS.it },
  finance:  { ...ACCOUNTS.finance },
  emp021:   { ...employee('Emp021'), name: 'Aiden Nair (Emp021, no case)' },
  emp022:   { ...employee('Emp022'), name: 'Priya Nair (Emp022, has case)' },
}

const clients = {}
for (const [k, a] of Object.entries(ROLES)) {
  try {
    const { client, userId } = await anonAs(a.email, a.password)
    clients[k] = { client, userId, acct: a }
    console.log(`signed in ${k.padEnd(8)} ${a.email.padEnd(24)} uid=${userId}`)
  } catch (e) {
    console.log(`SIGNIN FAIL ${k}: ${e.message}`)
  }
}

const res = (label, role, { data, error, count }) => {
  const n = data ? data.length : (count ?? 0)
  const out = { label, role, rows: n, err: error ? `${error.code||''} ${error.message}`.trim() : null }
  if (data && data.length) out.sampleCols = Object.keys(data[0])
  return out
}
const rows = []
const show = (r) => { rows.push(r); console.log(` ${r.role.padEnd(8)} | ${r.label.padEnd(52)} | rows=${String(r.rows).padEnd(4)} | ${r.err ? 'ERR: '+r.err : 'ok'}${r.sampleCols ? ' | cols=' + r.sampleCols.join(',') : ''}`) }

console.log('\n===== 1. exit_cases assessment columns (risk_level, risk_score, rehire_eligible) =====')
for (const [k, c] of Object.entries(clients)) {
  show(res('SELECT risk_level,risk_score,rehire_eligible FROM exit_cases', k,
    await c.client.from('exit_cases').select('risk_level,risk_score,rehire_eligible')))
}

console.log('\n===== 2. SELECT * FROM exit_cases =====')
for (const [k, c] of Object.entries(clients)) {
  const r = await c.client.from('exit_cases').select('*')
  show(res('SELECT * FROM exit_cases', k, r))
  if (r.data && r.data.length) {
    const leak = ['risk_level','risk_score','rehire_eligible'].filter(f => f in r.data[0])
    console.log(`          -> assessment cols present in payload: ${leak.join(',') || 'NONE'} ; first row risk=${JSON.stringify({rl:r.data[0].risk_level, rs:r.data[0].risk_score, re:r.data[0].rehire_eligible})}`)
  }
}

console.log('\n===== 3. exit_interviews summary/sentiment/themes/rehire_eligible =====')
for (const [k, c] of Object.entries(clients)) {
  show(res('SELECT summary,sentiment,themes,rehire_eligible FROM exit_interviews', k,
    await c.client.from('exit_interviews').select('summary,sentiment,themes,rehire_eligible')))
}
console.log('  (also SELECT * on exit_interviews)')
for (const [k, c] of Object.entries(clients)) {
  show(res('SELECT * FROM exit_interviews', k, await c.client.from('exit_interviews').select('*')))
}

console.log('\n===== 4. other tables =====')
for (const t of ['trend_alerts','analytics_insights','kt_reviews','compliance_checks','agent_runs','case_documents','profiles','exit_tasks']) {
  for (const [k, c] of Object.entries(clients)) {
    show(res(`SELECT * FROM ${t}`, k, await c.client.from(t).select('*')))
  }
  console.log('')
}

console.log('\n===== 5. exit_docs (EVERYONE incl. HR must get 0) =====')
for (const [k, c] of Object.entries(clients)) {
  show(res('SELECT * FROM exit_docs', k, await c.client.from('exit_docs').select('id,content')))
}

console.log('\n===== 6. rpc match_exit_docs with zero vector =====')
const zero = new Array(1536).fill(0)
for (const [k, c] of Object.entries(clients)) {
  const r = await c.client.rpc('match_exit_docs', { query_embedding: zero, match_count: 5 })
  show(res('rpc match_exit_docs(zero vector)', k, r))
}

console.log('\n===== 7/8/9. role views =====')
const VIEWS = ['employee_exit_view','manager_case_view','it_task_view','finance_case_view','employee_interview_status_view']
for (const v of VIEWS) {
  for (const [k, c] of Object.entries(clients)) {
    const r = await c.client.from(v).select('*')
    show(res(`SELECT * FROM ${v}`, k, r))
  }
  console.log('')
}
