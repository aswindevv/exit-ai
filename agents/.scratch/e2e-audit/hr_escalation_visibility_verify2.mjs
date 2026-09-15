// Continuation: escalation for the disposable case already exists (created by
// the previous partial run). Verifies HR Escalations view + employee on-hold
// display only.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
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

// --- Step B: HR Escalations view ---
const hrPage = await newLoggedInPage('siva@company.com', 'siva@1', /\/hr/)
await hrPage.goto(`${BASE}/hr/escalations`, { waitUntil: 'networkidle' })
const bodyText = await hrPage.locator('body').innerText()
console.log('STEP_B disposable case (Aiden Nair) visible:', bodyText.includes('Aiden Nair'))
console.log('STEP_B all 3 real escalation cases visible:', REAL_ESCALATION_NAMES.every((n) => bodyText.includes(n)))
console.log('STEP_B honest "not captured" reason shown:', bodyText.includes('Not captured'))
console.log('STEP_B status label shown:', bodyText.includes('Awaiting HR review'))
console.log('STEP_B follow-up note shown:', bodyText.includes('follow-up'))
await hrPage.screenshot({ path: 'agents/.scratch/e2e-audit/hr_escalations_view.png', fullPage: true })

await hrPage.goto(`${BASE}/hr/all-exits`, { waitUntil: 'networkidle' })
console.log('STEP_B all-exits page still renders:', (await hrPage.locator('.card-title', { hasText: 'All exit cases' }).count()) > 0)

// --- Step C: employee-facing on-hold status ---
const empPage = await newLoggedInPage('emp021@gmail.com', 'Emp021@', /\/employee/)
await empPage.waitForTimeout(1000)
const dashText = await empPage.locator('body').innerText()
console.log('STEP_C dashboard shows on-hold chip:', dashText.includes('On hold'))
await empPage.goto(`${BASE}/employee/timeline`, { waitUntil: 'networkidle' })
const tlText = await empPage.locator('body').innerText()
console.log('STEP_C timeline shows on-hold tag:', tlText.includes('On hold'))
await empPage.screenshot({ path: 'agents/.scratch/e2e-audit/employee_onhold.png', fullPage: true })

console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors))
await browser.close()
console.log('VERIFY_SCRIPT_DONE')
