import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
const failedReqs = []
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`) })

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })
console.log('landed on:', page.url())
console.log('consoleErrors:', JSON.stringify(consoleErrors))
console.log('failedReqs:', JSON.stringify(failedReqs))
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/it/dashboard.png', fullPage: true })
await browser.close()
