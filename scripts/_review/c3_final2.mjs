import { svc } from './lib.mjs'
const db = svc()
const { data } = await db.from('exit_cases').select('id,employee_id,employee_name,status,created_at').order('created_at')
const seeded = new Set(['001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','022','051','052','053','054','056','060'].map(n=>'Emp'+n))
console.log('total', data.length)
console.log('non-seeded cases present (other tracks):')
data.filter(c=>!seeded.has(c.employee_id)).forEach(c=>console.log('  ', c.employee_id, c.id, c.status, c.created_at))
console.log('seeded count:', data.filter(c=>seeded.has(c.employee_id)).length)
