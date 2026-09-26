// Phase 2 seed: 100 fake employees + 3 named accounts + a demo case with tasks.
// Uses SERVICE_KEY (never ship this file's key into the frontend). Re-runnable:
// skips anything that already exists in `profiles` / `exit_cases`.
import { createClient } from '@supabase/supabase-js'

process.loadEnvFile()

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_KEY
if (!url || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env')

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} missing in .env`)
  return value
}

const domain = requiredEnv('DEMO_EMAIL_DOMAIN')
const employeePasswordTemplate = requiredEnv('SEED_EMPLOYEE_PASSWORD_TEMPLATE')

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const DEPARTMENTS = [
  ['Engineering', 'Software Engineer'],
  ['Sales', 'Sales Executive'],
  ['Marketing', 'Marketing Specialist'],
  ['Finance', 'Financial Analyst'],
  ['Support', 'Support Engineer'],
  ['Product', 'Product Analyst'],
  ['Operations', 'Operations Coordinator'],
  ['HR', 'HR Generalist'],
]
const FIRST = ['Aiden', 'Priya', 'Liam', 'Zoya', 'Noah', 'Ananya', 'Ethan', 'Diya', 'Mason', 'Ishaan']
const LAST = ['Sharma', 'Patel', 'Nair', 'Iyer', 'Khan', 'Reddy', 'Gupta', 'Verma', 'Rao', 'Singh']

const TASK_TEMPLATES = [
  { stage: 'hr', title: 'Submit resignation letter', status: 'done' },
  { stage: 'hr', title: 'Complete exit interview', status: 'pending' },
  { stage: 'manager', title: 'Approve knowledge-transfer plan', status: 'pending' },
  { stage: 'it', title: 'Disable email & SSO access', status: 'pending' },
  { stage: 'it', title: 'Return laptop & access card', status: 'pending' },
  { stage: 'finance', title: 'Clear final settlement dues', status: 'pending' },
]

async function createPerson({ email, password, full_name, role, employee_id, department }) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`auth.createUser(${email}): ${error.message}`)
  const { error: pErr } = await db
    .from('profiles')
    .insert({ id: data.user.id, role, full_name, email, employee_id, department })
  if (pErr) throw new Error(`profiles.insert(${email}): ${pErr.message}`)
  return data.user.id
}

async function main() {
  const { data: existing, error } = await db.from('profiles').select('employee_id, email')
  if (error) throw error
  const doneIds = new Set(existing.map((r) => r.employee_id).filter(Boolean))
  const doneEmails = new Set(existing.map((r) => r.email))

  // Named demo accounts are configured in .env so credentials never live in source.
  const named = [
    { full_name: 'Aravidhan', email: requiredEnv('SEED_MANAGER_EMAIL'), role: 'manager', password: requiredEnv('SEED_MANAGER_PASSWORD') },
    { full_name: 'Siva', email: requiredEnv('SEED_HR_EMAIL'), role: 'hr', password: requiredEnv('SEED_HR_PASSWORD') },
    { full_name: 'Aswin', email: requiredEnv('SEED_IT_EMAIL'), role: 'it', password: requiredEnv('SEED_IT_PASSWORD') },
    { full_name: 'Anfia', email: requiredEnv('SEED_FINANCE_EMAIL'), role: 'finance', password: requiredEnv('SEED_FINANCE_PASSWORD') },
  ]
  for (const p of named) {
    if (doneEmails.has(p.email)) {
      console.log(`skip ${p.email} (exists)`)
      continue
    }
    await createPerson({ ...p, employee_id: null, department: null })
    console.log(`created ${p.email}`)
  }
  const { data: mgrHr } = await db.from('profiles').select('id, role').in('role', ['manager', 'hr'])
  const ids = {}
  for (const row of mgrHr) ids[row.role] = row.id

  // 100 employees.
  const empProfiles = []
  for (let i = 0; i < 100; i++) {
    const num = String(i + 1).padStart(3, '0')
    const employee_id = `Emp${num}`
    const email = `emp${num}@${domain}`
    const full_name = `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]}`
    const [department, role_title] = DEPARTMENTS[i % DEPARTMENTS.length]
    empProfiles.push({ employee_id, email, full_name, department, role_title })
    if (doneIds.has(employee_id)) continue
    const password = employeePasswordTemplate.replaceAll('{employee_id}', employee_id)
    await createPerson({ email, password, full_name, role: 'employee', employee_id, department })
  }
  console.log(`employees seeded: ${empProfiles.length}`)

  // One demo case (+ checklist tasks) per employee, for a subset so the
  // dashboards have content ahead of Phase 6b generating real checklists.
  const { count: caseCount } = await db.from('exit_cases').select('*', { count: 'exact', head: true })
  if (caseCount > 0) {
    console.log(`exit_cases already seeded (${caseCount}), skipping`)
  } else {
    for (const ep of empProfiles.slice(0, 10)) {
      const lastDay = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      const { data: kase, error: kErr } = await db
        .from('exit_cases')
        .insert({
          employee_id: ep.employee_id,
          employee_name: ep.full_name,
          email: ep.email,
          department: ep.department,
          role_title: ep.role_title,
          manager_id: ids.manager,
          hr_id: ids.hr,
          last_working_day: lastDay,
          status: 'in_progress',
        })
        .select('id')
        .single()
      if (kErr) throw new Error(`exit_cases.insert(${ep.employee_id}): ${kErr.message}`)

      const tasks = TASK_TEMPLATES.map((t) => ({ ...t, case_id: kase.id, due_date: lastDay }))
      const { error: tErr } = await db.from('exit_tasks').insert(tasks)
      if (tErr) throw new Error(`exit_tasks.insert(${ep.employee_id}): ${tErr.message}`)
    }
    console.log('seeded exit_cases + exit_tasks for 10 employees')
  }
}

main()
  .then(() => {
    console.log('seed done')
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
