// Employee audit pass 2: disposable resignation-submission flow using Emp050
// (zero exit_case rows before this run). Confirms the EmployeeLayout redirect
// gate lands a caseless employee on /employee/resignation, exercises the
// invalid-submit guard (no last_working_day), then submits a valid
// resignation and confirms navigation + the non-fatal /activate-exit call.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const results = { consoleErrors: [], networkFailures: [], networkCalls: [] }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') results.consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => results.consoleErrors.push('pageerror: ' + err.message))
page.on('response', async (res) => {
  const url = res.url()
  if (url.includes('submit-resignation') || url.includes('activate-exit')) {
    results.networkCalls.push({ url, status: res.status() })
  }
  if (res.status() >= 400) results.networkFailures.push(`${res.status()} ${res.request().method()} ${url}`)
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'emp050@gmail.com')
await page.fill('#login-password', 'Emp050@')
await page.click('.login-submit')
await page.waitForURL(/\/employee\/resignation/, { timeout: 10000 })
results.landedOnResignation = page.url()
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/resignation_form.png' })

// Invalid-input check: no last_working_day filled -- submit button must stay disabled.
results.submitDisabledWithNoDate = await page.locator('.login-submit').isDisabled()

// Valid submission.
await page.fill('#resign-last-day', '2026-12-31')
await page.fill('#resign-reason', 'AUDIT-DISPOSABLE: automated test resignation, safe to delete')
results.submitEnabledAfterDate = !(await page.locator('.login-submit').isDisabled())
await page.click('.login-submit')

await page.waitForURL(/\/employee\/?$/, { timeout: 15000 })
results.landedAfterSubmit = page.url()
await page.waitForTimeout(1500) // let the non-fatal activate-exit POST land
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/dashboard_after_resignation.png' })

await browser.close()
console.log(JSON.stringify(results, null, 2))
