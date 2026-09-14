// Re-verify: fresh employee resigns -> pipeline triggers -> checklist
// generated -> dashboard shows tasks. Scoped locators only.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const EMAIL = 'emp014@gmail.com'
const PASSWORD = 'Emp014@'

const browser = await chromium.launch()
const page = await browser.newPage()

let activateExitResponse = null
page.on('response', async (res) => {
  if (res.url().includes('/activate-exit')) {
    try { activateExitResponse = await res.json() } catch { /* ignore */ }
  }
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill(EMAIL)
await page.locator('#login-password').fill(PASSWORD)
await page.locator('button.login-submit').click()
await page.waitForURL('**/employee/resignation', { timeout: 15000 })

const lastDay = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
await page.locator('#resign-last-day').fill(lastDay)
await page.locator('#resign-reason').fill('Playwright pipeline-fix re-verification.')
await page.locator('button.login-submit').click()
await page.waitForURL('**/employee', { timeout: 20000 })
await page.waitForTimeout(500)

console.log('activate-exit response:', JSON.stringify(activateExitResponse))

await page.waitForSelector('.gauge-card', { timeout: 15000 })
const checklistRows = await page.locator('.card:has(.card-title:text-is("My checklist")) .list .row').count()
const progressText = await page.locator('.gauge span').innerText()

console.log(`dashboard checklist rows=${checklistRows}, progress=${progressText}`)

await browser.close()
