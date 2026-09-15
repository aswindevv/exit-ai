import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })

await page.click('.logout-btn')
await page.waitForTimeout(1500)
console.log('url after logout:', page.url())
const hasLoginForm = await page.locator('#login-email').count()
console.log('login form present after logout:', hasLoginForm > 0)
const bodyText = await page.locator('body').innerText()
console.log('body snippet:', bodyText.slice(0, 200))

// try reload to see if session truly cleared
await page.goto('http://localhost:5173/it', { waitUntil: 'networkidle' })
console.log('after navigating to /it post-logout, url:', page.url())
console.log('login form present:', (await page.locator('#login-email').count()) > 0)

await browser.close()
