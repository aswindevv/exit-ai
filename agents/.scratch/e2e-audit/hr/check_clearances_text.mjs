import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'siva@company.com')
await page.fill('#login-password', 'siva@1')
await page.click('.login-submit')
await page.waitForURL(/\/hr/, { timeout: 10000 })
await page.goto(`${BASE}/hr/clearances`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const text = await page.locator('body').innerText()
console.log('FULL_CLEARANCES_TEXT:', text)
await browser.close()
