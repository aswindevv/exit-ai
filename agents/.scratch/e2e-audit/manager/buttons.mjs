import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aravidhan@company.com')
await page.fill('#login-password', 'aravidhan@')
await page.click('.login-submit')
await page.waitForURL(/\/manager/, { timeout: 10000 })

const pages = ['manager', 'manager/my-team', 'manager/exiting-reports', 'manager/clearances', 'manager/timeline', 'manager/help']
for (const p of pages) {
  await page.goto(`${BASE}/${p}`, { waitUntil: 'networkidle' })
  const buttons = await page.$$eval('button', els => els.map(b => ({ text: b.textContent.trim(), disabled: b.disabled })))
  const inputs = await page.$$eval('input, textarea, select', els => els.map(e => ({ tag: e.tagName, type: e.type, name: e.name || e.id })))
  console.log(`\n=== /${p} ===`)
  console.log('buttons:', JSON.stringify(buttons))
  console.log('inputs/forms:', JSON.stringify(inputs))
}
await browser.close()
