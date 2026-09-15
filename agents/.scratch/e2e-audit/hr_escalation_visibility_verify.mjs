// Disposable Playwright verification for HR Escalation Visibility.
// Drives real dev server (5173) + real agent service (8787), real DB. No mocks.
// 1) Manager rejects a disposable KT task -> escalation created.
// 2) HR's new Escalations view shows the disposable case + the 3 real
//    pre-existing escalation cases (Mason Sharma / Ishaan Patel / Diya Sharma),
//    with employee/department/reason(not-captured)/when/status.
// 3) Employee dashboard + Timeline for the disposable employee show
//    "On hold · under HR review" instead of falsely "in progress".
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const DISPOSABLE_TASK_TITLE = 'KT handover with manager (disposable test)'
const REAL_ESCALATION_NAMES = ['Mason Sharma', 'Ishaan Patel', 'Diya Sharma']

const browser = await chromium.launch({ headless: true })
const consoleErrors = []

async function newLoggedInPage(email, password, roleRegex) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL(roleRegex, { timeout: 10000 })
  return page
}

// --- Step A: manager rejects the disposable KT task ---
const page = await newLoggedInPage('aravidhan@company.com', 'aravidhan@', /\/manager/)
await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
const disposableRow = page.locator('.row', { hasText: DISPOSABLE_TASK_TITLE })
await disposableRow.waitFor({ timeout: 10000 })
await disposableRow.locator('button', { hasText: 'Reject' }).click()
await page.waitForResponse((r) => r.url().includes('/reject-manager-task'), { timeout: 10000 })
await page.waitForTimeout(1000)
console.log('STEP_A manager reject fired OK')

// --- Step B: HR Escalations view ---
const hrPage = await newLoggedInPage('siva@company.com', 'siva@1', /\/hr/)
await hrPage.goto(`${BASE}/hr/escalations`, { waitUntil: 'networkidle' })
const bodyText = await hrPage.locator('body').innerText()
const hasDisposable = bodyText.includes('Aiden Nair')
const hasAllReal = REAL_ESCALATION_NAMES.every((n) => bodyText.includes(n))
const hasReasonNote = bodyText.includes('Not captured')
const hasAwaiting = bodyText.includes('Awaiting HR review')
console.log('STEP_B disposable case (Aiden Nair) visible:', hasDisposable)
console.log('STEP_B all 3 real escalation cases visible:', hasAllReal)
console.log('STEP_B honest "not captured" reason shown:', hasReasonNote)
console.log('STEP_B status label shown:', hasAwaiting)
await hrPage.screenshot({ path: 'agents/.scratch/e2e-audit/hr_escalations_view.png', fullPage: true })

// sanity: other HR pages still work (no regression)
await hrPage.goto(`${BASE}/hr/all-exits`, { waitUntil: 'networkidle' })
const allExitsOk = (await hrPage.locator('.card-title', { hasText: 'All exit cases' }).count()) > 0
console.log('STEP_B all-exits page still renders:', allExitsOk)

// --- Step C: employee-facing on-hold status ---
const empPage = await newLoggedInPage('emp021@gmail.com', 'Emp021@', /\/employee/)
const dashText = await empPage.locator('body').innerText()
console.log('STEP_C dashboard shows on-hold chip:', dashText.includes('On hold'))
await empPage.goto(`${BASE}/employee/timeline`, { waitUntil: 'networkidle' })
const tlText = await empPage.locator('body').innerText()
console.log('STEP_C timeline shows on-hold tag:', tlText.includes('On hold'))
await empPage.screenshot({ path: 'agents/.scratch/e2e-audit/employee_onhold.png', fullPage: true })

console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors))
await browser.close()
console.log('VERIFY_SCRIPT_DONE')
