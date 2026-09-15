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

const list = page.locator('.card--pad .list').first()
const html = await list.innerHTML()
const idx = html.indexOf('Disposable Test Case')
console.log('found at idx:', idx)
console.log(html.slice(Math.max(0, idx - 100), idx + 1500))
await browser.close()
