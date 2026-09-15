import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aravidhan@company.com')
await page.fill('#login-password', 'aravidhan@')
await page.click('.login-submit')
await page.waitForURL(/\/manager/, { timeout: 10000 })
await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })

// Find the disposable case's group block and inspect its two rows directly.
const groupBlock = page.locator('.list', { hasText: 'Disposable Test Case' })
const html = await groupBlock.innerHTML().catch(() => '(not found)')
console.log('DISPOSABLE GROUP HTML SNIPPET:')
console.log(html.slice(0, 3000))
await browser.close()
