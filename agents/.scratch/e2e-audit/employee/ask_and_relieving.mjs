// Pass 4: RAG assistant Ask/Forward-to-HR on Emp050's dashboard (safe,
// idempotent, non-mutating besides the Edge Function's own logging), plus a
// read-only check of the "Download relieving letter" button on a real
// completed account (Emp001) -- no DB/storage mutation, client-side blob only.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const results = {}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))

// --- Ask assistant (Emp050) ---
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'emp050@gmail.com')
await page.fill('#login-password', 'Emp050@')
await page.click('.login-submit')
await page.waitForURL(/\/employee\/?$/, { timeout: 10000 })

await page.fill('.ask-input', 'What is the notice period policy?')
await page.click('button:has-text("Ask")')
await page.waitForTimeout(4000)
results.askBodySnippet = (await page.locator('.strip').innerText()).slice(0, 400)
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/ask_result.png' })

const forwardBtn = page.locator('button:has-text("Forward to HR")')
results.forwardButtonVisibleAfterAsk = await forwardBtn.count() > 0
if (results.forwardButtonVisibleAfterAsk) {
  await forwardBtn.click()
  await page.waitForTimeout(3000)
  results.forwardBodySnippet = (await page.locator('.strip').innerText()).slice(0, 400)
  await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/forward_result.png' })
}
results.consoleErrorsAsk = consoleErrors.slice()

// Ask an off-topic question likely to be refused, to exercise the refusal + Forward path if not already.
if (!results.forwardButtonVisibleAfterAsk) {
  await page.fill('.ask-input', 'What is the CEO salary and company acquisition plans?')
  await page.click('button:has-text("Ask")')
  await page.waitForTimeout(4000)
  results.askOffTopicSnippet = (await page.locator('.strip').innerText()).slice(0, 400)
  const forwardBtn2 = page.locator('button:has-text("Forward to HR")')
  results.forwardButtonVisibleAfterOffTopic = await forwardBtn2.count() > 0
  if (results.forwardButtonVisibleAfterOffTopic) {
    await forwardBtn2.click()
    await page.waitForTimeout(3000)
    results.forwardBodySnippet2 = (await page.locator('.strip').innerText()).slice(0, 400)
  }
  await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/ask_offtopic_result.png' })
}

await page.locator('.logout-btn').click()
await page.waitForTimeout(500)

// --- Download relieving letter (Emp001, real completed account, read-only) ---
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'emp001@gmail.com')
await page.fill('#login-password', 'Emp001@')
await page.click('.login-submit')
await page.waitForURL(/\/employee\/?$/, { timeout: 10000 })
await page.waitForTimeout(500)
results.exitCompleteBodySnippet = (await page.locator('body').innerText()).slice(0, 300)
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/exit_complete_emp001.png' })

const downloadBtn = page.locator('button:has-text("Download relieving letter")')
results.downloadButtonVisible = await downloadBtn.count() > 0
if (results.downloadButtonVisible) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    downloadBtn.click(),
  ])
  results.downloadFilename = download.suggestedFilename()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
