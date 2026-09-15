import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aravidhan@company.com')
await page.fill('#login-password', 'aravidhan@')
await page.click('.login-submit')
await page.waitForURL(/\/manager/, { timeout: 10000 })
await page.waitForSelector('.logout-btn', { timeout: 5000 }).catch(() => null)
const logoutBtn = await page.$('.logout-btn')
console.log('logout btn found:', !!logoutBtn)
if (logoutBtn) {
  await logoutBtn.click()
  await page.waitForTimeout(1500)
  const loginVisible = await page.$('#login-email')
  console.log('login form visible after logout click:', !!loginVisible)
  console.log('url after logout:', page.url())
} else {
  console.log('body snippet:', (await page.textContent('body')).slice(0, 300))
}
await browser.close()
