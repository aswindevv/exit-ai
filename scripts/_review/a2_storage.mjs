import { anonAs, svc, ACCOUNTS, employee, j } from './lib.mjs'
const db = svc()
// find a real uploaded doc and its owning employee
const { data: docs } = await db.from('case_documents').select('case_id,file_path')
const { data: cases } = await db.from('exit_cases').select('id,employee_id')
const own = Object.fromEntries(cases.map(c => [c.id, c.employee_id]))
const real = docs.filter(d => d.file_path.includes('/') && !d.file_path.startsWith('agents/'))
console.log('real uploaded docs:', j(real.map(d => ({ emp: own[d.case_id], path: d.file_path }))))

const target = real.find(d => own[d.case_id] === 'Emp022') || real[0]
console.log('\ntarget doc owner =', own[target.case_id], ' path =', target.file_path)

const B = 'exit-documents'
const owner = employee(own[target.case_id])
const clients = {
  [`OWNER ${own[target.case_id]}`]: (await anonAs(owner.email, owner.password)).client,
  'OTHER Emp021': (await anonAs(employee('Emp021').email, employee('Emp021').password)).client,
  hr: (await anonAs(ACCOUNTS.hr.email, ACCOUNTS.hr.password)).client,
  manager: (await anonAs(ACCOUNTS.manager.email, ACCOUNTS.manager.password)).client,
  it: (await anonAs(ACCOUNTS.it.email, ACCOUNTS.it.password)).client,
}
for (const [k, c] of Object.entries(clients)) {
  const d = await c.storage.from(B).download(target.file_path)
  const l = await c.storage.from(B).list(target.file_path.split('/')[0], { limit: 10 })
  console.log(`  ${k.padEnd(16)} download -> ${d.error ? 'DENIED (' + d.error.message + ')' : 'GOT ' + d.data.size + ' bytes'} | list(prefix) -> ${l.error ? 'ERR ' + l.error.message : (l.data || []).length + ' entries'}`)
}
// upload attempt into someone else's folder
const other = clients['OTHER Emp021']
const up = await other.storage.from(B).upload(`${target.case_id}/A2-PROBE-${Date.now()}.txt`, new Blob(['a2']), { contentType: 'text/plain' })
console.log(`  OTHER Emp021 upload into another case folder -> ${up.error ? 'DENIED (' + up.error.message + ')' : 'UPLOADED ' + j(up.data) + '  <-- LEAK, must be cleaned'}`)
