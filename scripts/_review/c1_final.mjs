import { svc, casesFor, j } from './lib.mjs'
const db=svc()
const { data } = await db.from('exit_cases').select('id,employee_id,employee_name,created_at,status').order('created_at')
console.log('total cases:', data.length)
const PROT=new Set(['001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','022','051','052','053','054','056','060'].map(n=>'Emp'+n))
console.log('NON-protected cases (other tracks / residue):', j(data.filter(r=>!PROT.has(r.employee_id)).map(r=>`${r.employee_id} ${r.employee_name} ${r.id} ${r.created_at}`)))
console.log('casesFor(Emp031):', j(await casesFor('Emp031')))
for (const t of ['exit_tasks','agent_runs','compliance_checks','case_documents','kt_reviews','exit_interviews']) {
  const { data: rows } = await db.from(t).select('case_id')
  const ids=new Set(data.map(r=>r.id))
  const orph=(rows||[]).filter(r=>!ids.has(r.case_id))
  console.log(t, 'rows='+(rows||[]).length, 'orphaned='+orph.length)
}
