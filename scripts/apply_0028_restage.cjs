// Applies supabase/migrations/0028_restage_it_owned_manager_tasks.sql through
// the service-key REST client, for environments without the Supabase CLI /
// direct psql access. Same predicate as the SQL, same EXISTS safety rail, same
// idempotency: re-running matches nothing new.
//
//   node scripts/apply_0028_restage.cjs [--dry-run]
const { createClient } = require('@supabase/supabase-js')

process.loadEnvFile()

const DRY = process.argv.includes('--dry-run')
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// Mirrors hr_agent.IT_OWNED_TITLE_RE's access/account branch, which is the
// only branch 0028 re-stages (asset-collection titles are left alone: they are
// ambiguous enough that a manager may legitimately own the handover).
const IT_OWNED_RE =
  /^\s*(?:revoke|de-?provision|disable|deactivate|terminate|remove)\b[^.]*?\b(?:access|account|credential|login|sso|permission|licen[cs]e|key)s?\b/i

async function run() {
  const { data: tasks, error } = await db.from('exit_tasks').select('id,case_id,stage,title')
  if (error) throw error

  const casesWithIt = new Set(tasks.filter((t) => t.stage === 'it').map((t) => t.case_id))
  const targets = tasks.filter(
    (t) => t.stage === 'manager' && IT_OWNED_RE.test(t.title || '') && casesWithIt.has(t.case_id),
  )
  const skipped = tasks.filter(
    (t) => t.stage === 'manager' && IT_OWNED_RE.test(t.title || '') && !casesWithIt.has(t.case_id),
  )

  for (const t of targets) console.log(`  manager -> it  ${t.id}  ${t.title}`)
  for (const t of skipped) console.log(`  SKIPPED (case has no IT plan yet)  ${t.id}  ${t.title}`)
  if (DRY) return console.log(`\ndry run: ${targets.length} row(s) would move, ${skipped.length} skipped`)

  for (const t of targets) {
    const { error: e } = await db.from('exit_tasks').update({ stage: 'it' }).eq('id', t.id)
    if (e) throw e
  }
  console.log(`\n0028 applied: ${targets.length} row(s) re-staged, ${skipped.length} skipped`)
}

run().catch((e) => { console.error(e); process.exit(1) })
