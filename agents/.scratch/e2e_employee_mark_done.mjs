// Verify employee task completion (browser test gap #4), scoped to Emp007
// (a specific test employee with real, still-pending 'hr'-stage tasks).
// SCOPED locators only -- no unscoped .first() across the multi-row list.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const EMAIL = 'emp007@gmail.com'
const PASSWORD = 'Emp007@'
const HR_TASK_TITLE = 'Complete exit interview with HR'
const MANAGER_TASK_ID = '0debabb2-a63a-427a-9158-a677802140c7' // Emp007's stage='manager' task -- must stay untouchable

const results = []
function record(step, pass, detail) { results.push({ step, pass, detail }) }

const browser = await chromium.launch()
const page = await browser.newPage()

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill(EMAIL)
  await page.locator('#login-password').fill(PASSWORD)
  await page.locator('button.login-submit').click()
  await page.waitForURL('**/employee', { timeout: 15000 })
  await page.waitForSelector('.gauge-card', { timeout: 15000 })

  const progressBefore = await page.locator('.gauge span').innerText()

  await page.goto(`${BASE}/employee/tasks`, { waitUntil: 'networkidle' })
  const hrRow = page.locator('.card:has(.card-title:text-is("My tasks")) .row', { hasText: HR_TASK_TITLE })
  await hrRow.waitFor({ timeout: 10000 })
  const buttonVisibleBefore = await hrRow.locator('button.mark-done', { hasText: 'Mark done' }).isVisible()
  const statusBefore = buttonVisibleBefore ? 'Pending' : null

  await hrRow.locator('button.mark-done').click()
  await hrRow.locator('.status.c-success', { hasText: 'Done' }).waitFor({ timeout: 10000 })
  const statusAfter = await hrRow.locator('.status').innerText()

  await page.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.gauge-card', { timeout: 15000 })
  const progressAfter = await page.locator('.gauge span').innerText()

  record('1. Mark done (UI): hr-stage row flips to Done',
    statusBefore === 'Pending' && statusAfter === 'Done',
    `before="${statusBefore}" after="${statusAfter}"`)

  record('2. Progress % updates in the UI after marking done',
    progressBefore !== progressAfter,
    `before=${progressBefore} after=${progressAfter}`)

  // ---------- RLS: cannot mark a manager-stage task done ----------
  const rejected = await page.evaluate(async (taskId) => {
    const mod = await import('/src/lib/supabase.js')
    const { data, error } = await mod.supabase
      .from('exit_tasks')
      .update({ status: 'done' })
      .eq('id', taskId)
      .select()
    return { data, error: error?.message }
  }, MANAGER_TASK_ID)

  record('3. Employee CANNOT mark a manager-stage task done (RLS)',
    !rejected.error && Array.isArray(rejected.data) && rejected.data.length === 0,
    `direct update from employee session on manager-stage task -> rows=${JSON.stringify(rejected.data)} error=${rejected.error ?? 'none'} (expect 0 rows affected, RLS silently denies)`)

} catch (err) {
  record('UNEXPECTED ERROR', false, String(err && err.stack || err))
} finally {
  await browser.close()
}

console.log('\n=== SUMMARY ===')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.step}  ${r.pass ? '' : '-- ' + r.detail}`)
console.log(JSON.stringify(results, null, 2))
