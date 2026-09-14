import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => console.log('[console]', m.type(), m.text()))
page.on('response', async (r) => {
  if (r.url().includes('manager_case_view') || r.url().includes('/rest/v1/')) {
    console.log('[resp]', r.status(), r.url())
  }
})
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill('aravidhan@company.com')
await page.locator('#login-password').fill('aravidhan@')
await page.locator('button.login-submit').click()
await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
await page.waitForLoadState('networkidle')
await page.waitForTimeout(1000)
console.log('URL:', page.url())
console.log('BODY SNIPPET:', (await page.locator('.card').first().innerText().catch(() => 'n/a')))
await browser.close()
