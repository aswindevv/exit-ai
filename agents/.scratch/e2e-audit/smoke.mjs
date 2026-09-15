// Disposable Playwright smoke test -- confirms the raw `playwright` package
// (no @playwright/test runner, no config file exists or is needed) can
// actually drive the real running dev server: navigate, log in as one demo
// account, and confirm the resulting landing route matches AppRoutes.jsx.
// Not part of the audit findings itself -- just harness validation.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
console.log('loaded:', await page.title(), page.url())

await page.fill('#login-email', 'siva@company.com')
await page.fill('#login-password', 'siva@1')
await page.click('.login-submit')

await page.waitForURL(/\/hr/, { timeout: 10000 })
console.log('landed on:', page.url())

console.log('console errors during login:', JSON.stringify(consoleErrors))

await page.screenshot({ path: 'agents/.scratch/e2e-audit/smoke_hr_dashboard.png' })

await browser.close()
console.log('SMOKE TEST OK')
