// Phase 8 -- Smart Routing (#11) needs a REAL delegate profile to route to when
// the primary hr/manager/it approver is out_of_office. seed.js only creates one
// named account per role (Aravidhan/Siva/Aswin); this is the identical
// createPerson() pattern, just for a second person per role. Re-runnable:
// skips any email that already exists in `profiles`, same as seed.js.
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

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

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
  const { data: existing, error } = await db.from('profiles').select('email')
  if (error) throw error
  const doneEmails = new Set(existing.map((r) => r.email))

  const delegates = [
    { full_name: 'Divya (HR Delegate)', email: requiredEnv('SEED_HR_DELEGATE_EMAIL'), role: 'hr', password: requiredEnv('SEED_HR_DELEGATE_PASSWORD') },
    { full_name: 'Karthik (Manager Delegate)', email: requiredEnv('SEED_MANAGER_DELEGATE_EMAIL'), role: 'manager', password: requiredEnv('SEED_MANAGER_DELEGATE_PASSWORD') },
    { full_name: 'Meera (IT Delegate)', email: requiredEnv('SEED_IT_DELEGATE_EMAIL'), role: 'it', password: requiredEnv('SEED_IT_DELEGATE_PASSWORD') },
  ]
  for (const p of delegates) {
    if (doneEmails.has(p.email)) {
      console.log(`skip ${p.email} (exists)`)
      continue
    }
    await createPerson({ ...p, employee_id: null, department: null })
    console.log(`created ${p.email}`)
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
