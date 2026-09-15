import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aravidhan@company.com')
await page.fill('#login-password', 'aravidhan@')
await page.click('.login-submit')
await page.waitForURL(/\/manager/, { timeout: 10000 })
await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })

const row = page.locator('.row', { hasText: 'failure path' })
await row.waitFor({ timeout: 10000 })
const rejectBtn = row.locator('button', { hasText: 'Reject' })
await rejectBtn.click()
await page.waitForTimeout(2000) // fetch will reject (connection refused), no server round trip to await

const rowNow = page.locator('.row', { hasText: 'failure path' })
const stillHasButtons = await rowNow.locator('button').count()
const errorTextVisible = await rowNow.locator('.c-danger', { hasText: /unreachable|failed|Failed/i }).isVisible().catch(() => false)
const errorText = await rowNow.locator('.c-danger').first().textContent().catch(() => null)
const escalatedTagShown = await rowNow.locator('.tag.t-danger', { hasText: 'Escalated to HR' }).isVisible().catch(() => false)

console.log('FAILPATH buttons still present:', stillHasButtons)
console.log('FAILPATH error message shown:', errorTextVisible, 'text:', errorText)
console.log('FAILPATH false-success (escalated tag shown):', escalatedTagShown)
console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors))

await page.screenshot({ path: 'agents/.scratch/e2e-audit/manager_reject_failpath.png' })
await browser.close()
