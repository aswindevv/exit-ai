import { anonAs, j } from './lib.mjs'
const DEL = [
  ['manager.delegate@gmail.com','mgrdelegate@','manager-delegate (owns 0 cases)'],
  ['hr.delegate@gmail.com','hrdelegate@','hr-delegate'],
  ['it.delegate@gmail.com','itdelegate@','it-delegate'],
]
for (const [em, pw, label] of DEL) {
  let c
  try { c = (await anonAs(em, pw)).client } catch (e) { console.log(`SIGNIN FAIL ${label}: ${e.message}`); continue }
  const probes = {
    exit_cases:        await c.from('exit_cases').select('id,risk_level,risk_score,rehire_eligible'),
    exit_tasks:        await c.from('exit_tasks').select('id,stage'),
    exit_interviews:   await c.from('exit_interviews').select('summary,sentiment'),
    manager_case_view: await c.from('manager_case_view').select('id'),
    it_task_view:      await c.from('it_task_view').select('id'),
    finance_case_view: await c.from('finance_case_view').select('id'),
    agent_runs:        await c.from('agent_runs').select('id'),
    trend_alerts:      await c.from('trend_alerts').select('id'),
  }
  console.log(`\n--- ${label} (${em}) ---`)
  for (const [k, r] of Object.entries(probes)) {
    console.log(`  ${k.padEnd(20)} rows=${String(r.data?r.data.length:0).padEnd(5)} ${r.error ? 'ERR '+r.error.message : ''}`)
  }
  if (probes.exit_tasks.data?.length) console.log('   stages:', j([...new Set(probes.exit_tasks.data.map(t=>t.stage))]))
  if (probes.exit_cases.data?.length) console.log('   LEAK sample:', j(probes.exit_cases.data[0]))
}
