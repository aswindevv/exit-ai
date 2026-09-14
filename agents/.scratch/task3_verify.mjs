// Task 3 verification: HR "Issue relieving letter" action.
// - button shows for a case with all stages cleared + finance_cleared=true
// - button does NOT show for a case that isn't cleared
// - clicking it writes relieving_letter_issued/issued_at/issued_by and closes
//   the case (status -> completed), verified via HR's own JWT (ground truth)
// - HR still cannot write any other exit_cases field (RLS column grant scope)
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const SUPABASE_URL = 'https://ztwmjzbmdumdwxtjpmzs.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0d21qemJtZHVtZHd4dGpwbXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzkzOTIsImV4cCI6MjEwNDcxNTM5Mn0.xd7z2uh0eph7DCA6mA0qqVnpUayDS7iOVFW2PmcyYD4'
const READY_CASE_ID = '9596336c-e763-4258-9ffc-2c69a1d6c6f0' // Aiden Sharma: hr/manager/it/finance done + finance_cleared
const NOT_READY_CASE_ID = '3582dd2c-9bd7-4978-b57b-e7df5487b669' // Noah Patel: only hr/manager stages exist, finance_cleared false

const results = []
function record(name, pass, detail) { results.push({ name, pass, detail }) }

const browser = await chromium.launch()

// ---- 1. HR: button visible only for the cleared case ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('siva@company.com')
  await page.locator('#login-password').fill('siva@1')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.goto(`${BASE}/hr/clearances`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  const readyRow = page.locator('.row.row--split:has-text("Aiden Sharma")')
  const readyBtn = readyRow.locator('button:has-text("Issue relieving letter")')
  record('button visible for cleared case (Aiden Sharma)', await readyBtn.count() === 1, `count=${await readyBtn.count()}`)

  const notReadyRow = page.locator('.row.row--split:has-text("Noah Patel")')
  const notReadyBtn = notReadyRow.locator('button:has-text("Issue relieving letter")')
  record('button NOT shown for non-cleared case (Noah Patel)', await notReadyBtn.count() === 0, `count=${await notReadyBtn.count()}`)

  await readyBtn.click()
  await page.waitForFunction(
    () => document.body.innerText.includes('Issued'),
    null,
    { timeout: 15000 },
  )
  const afterClick = await page.locator('.card.card--pad').last().innerText()
  record('after click, case shows "Issued" in Clearances', afterClick.includes('Issued'), afterClick.slice(0, 400))
  await page.close()
}

// ---- 2. HR JWT: ground truth on the row (not text-fuzzy) ----
{
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'siva@company.com', password: 'siva@1' }),
  })
  const auth = await authRes.json()

  const res = await fetch(`${SUPABASE_URL}/rest/v1/exit_cases?id=eq.${READY_CASE_ID}&select=id,status,relieving_letter_issued,issued_at,issued_by,finance_cleared`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${auth.access_token}` },
  })
  const [row] = await res.json()
  record('row: relieving_letter_issued = true', row?.relieving_letter_issued === true, JSON.stringify(row))
  record('row: issued_at populated', !!row?.issued_at, JSON.stringify(row))
  record('row: issued_by populated', !!row?.issued_by, JSON.stringify(row))
  record('row: status = completed (case closed)', row?.status === 'completed', JSON.stringify(row))

  // ---- 3. HR JWT: cannot write any OTHER exit_cases field ----
  const badWrites = [
    { patch: { finance_cleared: false }, label: 'finance_cleared' },
    { patch: { risk_level: 'high' }, label: 'risk_level' },
    { patch: { dues_note: 'hr should not be able to set this' }, label: 'dues_note' },
    { patch: { employee_name: 'Tampered Name' }, label: 'employee_name' },
  ]
  for (const { patch, label } of badWrites) {
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/exit_cases?id=eq.${READY_CASE_ID}`, {
      method: 'PATCH',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    })
    const body = await patchRes.json()
    const blocked = patchRes.status >= 400 || (Array.isArray(body) && body.length === 0)
    record(`HR JWT: cannot write ${label}`, blocked, `status=${patchRes.status} body=${JSON.stringify(body)}`)
  }

  // ---- 4. HR JWT: re-issuing (already issued) is rejected ----
  const reissueRes = await fetch(`${SUPABASE_URL}/rest/v1/exit_cases?id=eq.${READY_CASE_ID}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ relieving_letter_issued: true, status: 'completed', issued_at: new Date().toISOString(), issued_by: row.issued_by }),
  })
  const reissueBody = await reissueRes.json()
  const reissueBlocked = reissueRes.status >= 400 || (Array.isArray(reissueBody) && reissueBody.length === 0)
  record('HR JWT: cannot re-issue an already-issued case', reissueBlocked, `status=${reissueRes.status} body=${JSON.stringify(reissueBody)}`)
}

// ---- 5. HR: All exits page shows the case as Completed ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('siva@company.com')
  await page.locator('#login-password').fill('siva@1')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.goto(`${BASE}/hr/all-exits`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const aidenRow = page.locator('.row:has-text("Aiden Sharma")')
  const statusTag = await aidenRow.locator('.tag').first().innerText()
  record('All exits: Aiden Sharma shows Completed', statusTag.trim() === 'Completed', statusTag.trim())
  await page.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
const anyFail = results.some((r) => !r.pass)
process.exit(anyFail ? 1 : 0)
