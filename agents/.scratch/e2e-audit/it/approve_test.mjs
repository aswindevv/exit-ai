import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
const failedReqs = []
const allReqs = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
page.on('response', (r) => {
  allReqs.push(`${r.status()} ${r.url()}`)
  if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`)
})

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })

await page.goto('http://localhost:5173/it/deprovisioning', { waitUntil: 'networkidle' })

// find the row for our disposable employee (Ishaan Gupta) with the target task
const row = page.locator('div.row', { hasText: 'Disable SSO account access' }).filter({ hasText: 'Pending' })
console.log('matching row count for Emp070 task:', await row.count())

// scope to the section containing "Ishaan Gupta" to avoid other similarly-titled tasks
const text = await page.locator('body').innerText()
console.log('page contains Ishaan Gupta:', text.includes('Ishaan Gupta'))

await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/it/before_approve.png', fullPage: true })

// click the Approve button in the row that has our disposable task title
const target = page.locator('div.row', { hasText: 'Disable SSO account access' })
const approveBtn = target.locator('button', { hasText: 'Approve' })
console.log('approve button count in target row:', await approveBtn.count())
await approveBtn.first().click()

await page.waitForTimeout(2000)
console.log('consoleErrors after approve:', JSON.stringify(consoleErrors))
console.log('failedReqs after approve:', JSON.stringify(failedReqs))
console.log('relevant reqs:', JSON.stringify(allReqs.filter(r => r.includes('8787') || r.includes('exit_tasks'))))

const afterText = await page.locator('body').innerText()
const idx = afterText.indexOf('Disable SSO account access')
console.log('context around task after approve:', afterText.slice(Math.max(0, idx - 80), idx + 120))

await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/it/after_approve.png', fullPage: true })

await browser.close()
