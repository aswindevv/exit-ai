// Re-verify step 7 (ASK) only, using Emp013 who already resigned in the prior
// full run and now lands on the dashboard directly -- no new mutation.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const EMAIL = 'emp013@gmail.com'
const PASSWORD = 'Emp013@'

const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill(EMAIL)
await page.locator('#login-password').fill(PASSWORD)
await page.locator('button.login-submit').click()
await page.waitForURL('**/employee', { timeout: 15000 })
await page.waitForSelector('.ask-input', { timeout: 15000 })

async function askAndCapture(question) {
  const respPromise = page.waitForResponse((r) => r.url().includes('/functions/v1/ask'), { timeout: 20000 })
  await page.locator('.ask-input').fill(question)
  await page.locator('.strip--top button', { hasText: 'Ask' }).click()
  const resp = await respPromise
  const body = await resp.json().catch(() => null)
  await page.waitForFunction(
    () => !document.querySelector('.strip-body')?.textContent.includes('Ask me anything'),
    { timeout: 10000 },
  ).catch(() => {})
  const domText = await page.locator('.strip-body').first().innerText().catch(() => '')
  return { body, domText }
}

const q1 = await askAndCapture('When do I get my final settlement?')
const q2 = await askAndCapture('What is the capital of France?')

console.log('Q1:', JSON.stringify(q1))
console.log('Q2:', JSON.stringify(q2))

await browser.close()
