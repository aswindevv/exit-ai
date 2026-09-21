// Shared helpers for the permanent verification/regression scripts in this directory.
// Used by regression_db.mjs and baseline.mjs.
//
// Two clients on purpose:
//   svc()  service key, bypasses RLS — for SNAPSHOTS, SETUP and CLEANUP only.
//   anon() anon key + a real signInWithPassword — this is the ONLY correct way
//          to test RLS, because the service key would pass every check.
import { createClient } from '@supabase/supabase-js'
process.loadEnvFile()

export const URL_ = process.env.SUPABASE_URL
export const ANON = process.env.SUPABASE_ANON_KEY
export const SVC = process.env.SUPABASE_SERVICE_KEY
export const APP = 'http://localhost:5173'
export const AGENT_SVC = 'http://localhost:8787'

export const svc = () => createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } })

/** Fresh anon client signed in as one real user. Throws on bad credentials. */
export async function anonAs(email, password) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn(${email}): ${error.message}`)
  return { client: c, userId: data.user.id }
}

export const ACCOUNTS = {
  hr: { email: 'siva@company.com', password: 'siva@1', name: 'Siva', landing: '/hr' },
  manager: { email: 'aravidhan@company.com', password: 'aravidhan@', name: 'Aravidhan', landing: '/manager' },
  it: { email: 'aswin@gmail.com', password: 'aswin@', name: 'Aswin', landing: '/it' },
  finance: { email: 'anfiacj@gmail.com', password: 'anfiacj@', name: 'Anfia', landing: '/finance' },
}
export const employee = (id) => ({
  email: `${id.toLowerCase()}@gmail.com`,
  password: `${id}@`,
  employee_id: id,
  landing: '/employee',
})

/** Playwright login. Scoped selectors only — the login form has real ids. */
export async function login(page, email, password) {
  await page.goto(APP + '/', { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('button.login-submit')
  await page.waitForLoadState('networkidle')
}

/** Collect console errors + page errors for a page. Returns a live array. */
export function trackErrors(page) {
  const errs = []
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)))
  return errs
}

/**
 * Hard delete a disposable case and everything hanging off it.
 * ONLY ever call with a case id you created during this review.
 * Refuses to touch a case whose employee_id is in the protected set.
 */
const PROTECTED = new Set(
  ['001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','022','051','052','053','054','056','060'].map((n) => 'Emp' + n),
)
export async function purgeCase(caseId, expectEmployeeId) {
  const db = svc()
  const { data: c } = await db.from('exit_cases').select('id, employee_id').eq('id', caseId).maybeSingle()
  if (!c) return { purged: false, reason: 'case not found (already gone)' }
  if (PROTECTED.has(c.employee_id)) throw new Error(`REFUSING to purge protected seeded case ${c.employee_id}`)
  if (expectEmployeeId && c.employee_id !== expectEmployeeId) {
    throw new Error(`REFUSING: case ${caseId} belongs to ${c.employee_id}, expected ${expectEmployeeId}`)
  }
  // Children first; several have ON DELETE CASCADE but be explicit so the
  // count is verifiable and it works even where cascade is absent.
  const counts = {}
  for (const t of ['agent_runs', 'compliance_checks', 'case_documents', 'kt_reviews', 'exit_interviews', 'exit_tasks']) {
    const { data, error } = await db.from(t).delete().eq('case_id', caseId).select('id')
    counts[t] = error ? `ERR ${error.message}` : (data || []).length
  }
  const { error: cErr } = await db.from('exit_cases').delete().eq('id', caseId)
  counts.exit_cases = cErr ? `ERR ${cErr.message}` : 1
  return { purged: !cErr, employee_id: c.employee_id, counts }
}

/** Every case id currently belonging to one employee (should be 0 or 1). */
export async function casesFor(employeeId) {
  const { data } = await svc().from('exit_cases').select('id, status, created_at').eq('employee_id', employeeId)
  return data || []
}

export async function post(path, body) {
  const res = await fetch(AGENT_SVC + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, body: json ?? text }
}

export const j = (v) => JSON.stringify(v, null, 1)
