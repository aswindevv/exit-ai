// Emp014 already resigned (prior script's submission completed server-side,
// just outran the client nav timeout). Confirm the dashboard now shows it.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const EMAIL = 'emp014@gmail.com'
const PASSWORD = 'Emp014@'

const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill(EMAIL)
await page.locator('#login-password').fill(PASSWORD)
await page.locator('button.login-submit').click()
await page.waitForURL('**/employee', { timeout: 15000 })

await page.waitForSelector('.gauge-card', { timeout: 15000 })
const checklistRows = await page.locator('.card:has(.card-title:text-is("My checklist")) .list .row').count()
const progressText = await page.locator('.gauge span').innerText()
const rowTitles = await page.locator('.card:has(.card-title:text-is("My checklist")) .list .row').allInnerTexts()

console.log(`landed on ${page.url()}`)
console.log(`checklist rows=${checklistRows}, progress=${progressText}`)
console.log('row titles:', JSON.stringify(rowTitles))

await browser.close()
