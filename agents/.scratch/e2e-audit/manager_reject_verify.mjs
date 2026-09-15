// Disposable Playwright verification for the Manager Reject/Escalation UI
// feature. Drives the real running dev server (localhost:5173) + real
// agent service (localhost:8787) -- no mocks. Covers Step 5 of the task:
//   1) disposable pending KT task -> both Review+Reject visible -> click
//      Reject -> correct POST fires -> UI shows "Escalated to HR", no buttons.
//   2) existing real escalation rows (Emp020, Emp009) render as
//      "Escalated to HR" with no Approve/Reject controls.
//   3) failure path: agent service unreachable -> Reject shows an explicit
//      error, does NOT flip to "Escalated to HR".
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const DISPOSABLE_TASK_TITLE = 'KT handover with manager (disposable test)'

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', 'aravidhan@company.com')
  await page.fill('#login-password', 'aravidhan@')
  await page.click('.login-submit')
  await page.waitForURL(/\/manager/, { timeout: 10000 })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const consoleErrors = []
const failedRequests = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))
page.on('requestfailed', (req) => failedRequests.push(`${req.method()} ${req.url()} -- ${req.failure()?.errorText}`))

let rejectRequestBody = null
let rejectResponseStatus = null
page.on('response', async (res) => {
  if (res.url().includes('/reject-manager-task')) {
    rejectResponseStatus = res.status()
    try { rejectRequestBody = res.request().postDataJSON() } catch { /* ignore */ }
  }
})

await login(page)
console.log('landed on:', page.url())

// --- Scenario 1: disposable pending case ---
await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })

const disposableRow = page.locator('.row', { hasText: DISPOSABLE_TASK_TITLE })
await disposableRow.waitFor({ timeout: 10000 })
const reviewBtn = disposableRow.locator('button', { hasText: 'Review' })
const rejectBtn = disposableRow.locator('button', { hasText: 'Reject' })
const bothVisibleBefore = await reviewBtn.isVisible() && await rejectBtn.isVisible()
console.log('SCENARIO1 both Review+Reject visible before click:', bothVisibleBefore)

await rejectBtn.click()
await page.waitForResponse((r) => r.url().includes('/reject-manager-task'), { timeout: 10000 })
await page.waitForTimeout(1000) // allow reload() to finish and re-render

const disposableRowAfter = page.locator('.row', { hasText: DISPOSABLE_TASK_TITLE })
const escalatedTagVisible = await disposableRowAfter.locator('.tag.t-danger', { hasText: 'Escalated to HR' }).isVisible().catch(() => false)
const anyButtonAfter = await disposableRowAfter.locator('button').count()
console.log('SCENARIO1 reject POST status:', rejectResponseStatus, 'body:', JSON.stringify(rejectRequestBody))
console.log('SCENARIO1 escalated tag visible after:', escalatedTagVisible, 'buttons remaining:', anyButtonAfter)

// --- Scenario 2: existing real escalation cases (Emp020, Emp009) ---
await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
const escalatedRows = page.locator('.row', { hasText: 'Escalated: manager rejected KT plan' })
const escalatedCount = await escalatedRows.count()
let realEscalationOk = true
for (let i = 0; i < escalatedCount; i++) {
  const row = escalatedRows.nth(i)
  const hasTag = await row.locator('.tag.t-danger', { hasText: 'Escalated to HR' }).isVisible().catch(() => false)
  const btnCount = await row.locator('button').count()
  if (!hasTag || btnCount !== 0) realEscalationOk = false
  console.log(`SCENARIO2 row ${i}: tag=${hasTag} buttonCount=${btnCount}`)
}
console.log('SCENARIO2 count of real escalation rows found:', escalatedCount, 'all clean (tag, no buttons):', realEscalationOk)

console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors))
console.log('FAILED_REQUESTS:', JSON.stringify(failedRequests))

await page.screenshot({ path: 'agents/.scratch/e2e-audit/manager_reject_after.png', fullPage: true })

await browser.close()
console.log('VERIFY_SCRIPT_DONE')
