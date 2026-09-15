import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ headless: true })
const results = {}

async function newLoggedInPage(email, password, roleRegex) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL(roleRegex, { timeout: 10000 })
  return page
}

{
  const page = await newLoggedInPage('siva@company.com', 'siva@1', /\/hr/)
  await page.goto(`${BASE}/hr/all-exits`, { waitUntil: 'networkidle' })
  results.hr_all_exits_renders = (await page.locator('.card-title', { hasText: 'All exit cases' }).count()) > 0
  await page.goto(`${BASE}/hr`, { waitUntil: 'networkidle' })
  results.hr_dashboard_renders = (await page.locator('body').innerText()).length > 0
}
{
  const page = await newLoggedInPage('aravidhan@company.com', 'aravidhan@', /\/manager/)
  await page.waitForTimeout(1000)
  results.manager_dashboard_renders = (await page.locator('body').innerText()).length > 0
  await page.goto(`${BASE}/manager/clearances`, { waitUntil: 'networkidle' })
  results.manager_clearances_renders = (await page.locator('.card-title', { hasText: 'Clearances' }).count()) > 0
}
console.log('REGRESSION_RESULTS:', JSON.stringify(results, null, 2))
await browser.close()
console.log('DONE')
