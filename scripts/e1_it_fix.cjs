const { chromium } = require('playwright')
const BASE = 'http://localhost:5173'
const EMP_NAME = 'Mason Sharma'

async function run() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push(String(e)))

  await page.goto(BASE)
  await page.fill('#login-email', 'aswin@gmail.com')
  await page.fill('#login-password', 'aswin@')
  await page.click('button.login-submit')
  await page.waitForURL(/\/it/, { timeout: 15000 })
  await page.goto(`${BASE}/it/deprovisioning`)
  await page.waitForSelector(`div.row:has-text("${EMP_NAME}")`, { timeout: 10000 })

  let approved = 0
  for (let i = 0; i < 10; i++) {
    const row = page.locator('div.row', { hasText: EMP_NAME }).filter({ has: page.getByRole('button', { name: 'Approve' }) })
    if (await row.count() === 0) break
    await row.first().getByRole('button', { name: 'Approve' }).click()
    approved++
    await page.waitForTimeout(900)
  }
  await page.screenshot({ path: 'scripts/e1_screens/it_mason_after.png', fullPage: true })
  console.log(JSON.stringify({ approved, consoleErrors: errs }))
  await browser.close()
}
run().catch((e) => { console.error('FAIL:', e); process.exit(1) })
