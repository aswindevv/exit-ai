// Task 2 verification: employee exit-interview form -> row written ->
// confirmation shown -> agent analysis populates for HR -> employee cannot
// see any analysis field (via direct REST call with their own JWT, not just
// UI omission). Scoped, read/write-once against a case with no interview yet
// (Emp016 / emp016@gmail.com, case 80055c0f-b9fa-4f68-8bdc-bc77380940a2).
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const SUPABASE_URL = 'https://ztwmjzbmdumdwxtjpmzs.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0d21qemJtZHVtZHd4dGpwbXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzkzOTIsImV4cCI6MjEwNDcxNTM5Mn0.xd7z2uh0eph7DCA6mA0qqVnpUayDS7iOVFW2PmcyYD4'
const CASE_ID = '80055c0f-b9fa-4f68-8bdc-bc77380940a2'

const results = []
function record(name, pass, detail) { results.push({ name, pass, detail }) }

const browser = await chromium.launch()

// ---- 1. Employee: real form renders, fill + submit ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('emp016@gmail.com')
  await page.locator('#login-password').fill('Emp016@')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.goto(`${BASE}/employee/exit-interview`, { waitUntil: 'networkidle' })

  const hasForm = await page.locator('#ei-reason, #ei-feedback, #ei-recommend, #ei-comments').count()
  record('real form renders (4 fields)', hasForm === 4, `fields found=${hasForm}`)

  await page.locator('#ei-reason').fill('Better compensation elsewhere')
  await page.locator('#ei-feedback').fill('Management was supportive but growth was slow.')
  await page.locator('#ei-recommend').selectOption('yes')
  await page.locator('#ei-comments').fill('Would consider returning in a couple of years.')
  await page.locator('button[type="submit"]').click()

  await page.waitForFunction(
    () => document.body.innerText.includes('has been submitted'),
    null,
    { timeout: 40000 },
  )
  const confirmationText = await page.locator('.card.card--pad').innerText()
  record('confirmation shown after submit', confirmationText.includes('has been submitted'), confirmationText.trim())

  const analysisLeak = /summary|sentiment|rehire/i.test(confirmationText)
  record('confirmation contains NO analysis field', !analysisLeak, confirmationText.trim())

  // reload -> status persists via employee_interview_status_view, not just local state
  await page.reload({ waitUntil: 'networkidle' })
  const afterReload = await page.locator('.card.card--pad').innerText()
  record('confirmation persists after reload (no re-shown form)', afterReload.includes('has been submitted'), afterReload.trim())

  await page.close()
}

// ---- 2. DB: row written with raw fields ----
{
  const res = await fetch(`${SUPABASE_URL}/rest/v1/exit_interviews?case_id=eq.${CASE_ID}&select=*`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })
  // service-role check instead: query via HR login below covers row content;
  // this call (anon, no user JWT) should return [] because there is no
  // authenticated session -- confirms RLS default-denies with no auth at all.
  const rows = await res.json()
  record('anon (no session) sees 0 rows', Array.isArray(rows) && rows.length === 0, JSON.stringify(rows))
}

// ---- 3. HR: analysis populated and visible ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('siva@company.com')
  await page.locator('#login-password').fill('siva@1')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.goto(`${BASE}/hr/exit-interviews`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  const contentCard = page.locator('.card.card--pad')
  const cardText = await contentCard.innerText()
  record('HR exit-interviews page renders a list of interviews', cardText.includes('Exit interviews'), cardText.slice(0, 300))
  await page.close()
}

// ---- 3b. HR JWT: analysis fields are actually non-null (ground truth, not text-fuzzy) ----
{
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'siva@company.com', password: 'siva@1' }),
  })
  const auth = await authRes.json()
  const hrRes = await fetch(`${SUPABASE_URL}/rest/v1/exit_interviews?case_id=eq.${CASE_ID}&select=*`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${auth.access_token}` },
  })
  const [row] = await hrRes.json()
  const populated = !!row && !!row.summary && !!row.sentiment
  record('HR JWT: agent analysis (summary/sentiment) populated on the row', populated, JSON.stringify(row))
}

// ---- 4. Employee cannot read back the analysis fields (real REST call with THEIR own JWT) ----
{
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'emp016@gmail.com', password: 'Emp016@' }),
  })
  const auth = await authRes.json()
  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/exit_interviews?case_id=eq.${CASE_ID}&select=*`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${auth.access_token}` },
  })
  const empRows = await empRes.json()
  record('employee JWT: SELECT on exit_interviews returns 0 rows (RLS blocks, no summary/sentiment/rehire leak)',
    Array.isArray(empRows) && empRows.length === 0,
    JSON.stringify(empRows))

  const viewRes = await fetch(`${SUPABASE_URL}/rest/v1/employee_interview_status_view?select=*`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${auth.access_token}` },
  })
  const viewRows = await viewRes.json()
  const onlySafeCols = Array.isArray(viewRows) && viewRows.every((r) => Object.keys(r).every((k) => ['case_id', 'created_at'].includes(k)))
  record('employee JWT: status view exposes ONLY case_id/created_at (no analysis columns)',
    onlySafeCols,
    JSON.stringify(viewRows))
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
const anyFail = results.some((r) => !r.pass)
process.exit(anyFail ? 1 : 0)
