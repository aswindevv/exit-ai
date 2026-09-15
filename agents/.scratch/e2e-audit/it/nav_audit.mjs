import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
const failedReqs = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`) })

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })

const routes = ['', 'deprovisioning', 'asset-recovery', 'access-reviews', 'approvals', 'audit-log', 'help']
for (const r of routes) {
  await page.goto(`http://localhost:5173/it/${r}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const text = await page.locator('body').innerText()
  console.log(`--- /it/${r} --- len=${text.length} url=${page.url()}`)
  await page.screenshot({ path: `agents/.scratch/e2e-audit/screenshots/it/${r || 'dashboard'}.png`, fullPage: true })
}

// unauthorized route attempt
await page.goto('http://localhost:5173/hr', { waitUntil: 'networkidle' })
console.log('after visiting /hr as IT, landed on:', page.url())
await page.goto('http://localhost:5173/manager/kt-approvals', { waitUntil: 'networkidle' })
console.log('after visiting /manager/kt-approvals as IT, landed on:', page.url())

console.log('consoleErrors:', JSON.stringify(consoleErrors))
console.log('failedReqs:', JSON.stringify(failedReqs))

// logout: find logout button
await page.goto('http://localhost:5173/it', { waitUntil: 'networkidle' })
const logoutBtn = page.locator('.logout-btn')
console.log('logout button count:', await logoutBtn.count())
if (await logoutBtn.count()) {
  await logoutBtn.first().click()
  await page.waitForTimeout(1000)
  console.log('after logout click, url:', page.url())
}

await browser.close()
