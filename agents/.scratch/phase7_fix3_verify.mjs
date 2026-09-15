// Phase 7 fix #3: forward-to-hr must never surface a bare dispatch error or
// hang on SMTP failure -- it must record the escalation and show an honest
// "logged, may be delayed" message. The deployed function currently has
// SMTP_TIMEOUT_MS forced to 1 (temporary, restored right after this run) so
// the send deterministically fails without touching real email credentials.
// Disposable case: Emp022 (no real exit_cases row before this test).
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill('emp022@gmail.com')
await page.locator('#login-password').fill('Emp022@')
await page.locator('button.login-submit').click()
await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
await page.waitForLoadState('networkidle')
await page.waitForTimeout(1000)

const results = []
function record(name, pass, detail) { results.push({ name, pass, detail }) }

const askInput = page.locator('.ask-input')
await askInput.fill('What is the capital city of Mars?')
await page.getByRole('button', { name: /^Ask/ }).click()

const forwardBtn = page.getByRole('button', { name: /Forward to HR/i })
let refused = true
try {
  await forwardBtn.waitFor({ state: 'visible', timeout: 15000 })
} catch {
  refused = false
}
record('question was refused, Forward to HR offered', refused, `count=${await forwardBtn.count()}`)

await forwardBtn.click()
await page.waitForTimeout(4000) // 1ms SMTP timeout fires almost instantly; generous margin for the round trip

const warningMsg = page.locator('.strip-body.c-warning')
const successMsg = page.locator('.strip-body.c-success')
const dangerMsg = page.locator('.strip-body.c-danger')

record('no bare dispatch error shown', await dangerMsg.count() === 0, `count=${await dangerMsg.count()}`)
record('no false "Forwarded to HR" success shown', await successMsg.count() === 0, `count=${await successMsg.count()}`)
const warningText = await warningMsg.first().innerText().catch(() => '(none)')
record('honest delayed message shown', await warningMsg.count() === 1 && /logged/i.test(warningText), `text="${warningText}"`)

await browser.close()

const failures = results.filter((r) => !r.pass)
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} -- ${r.detail}`)
process.exit(failures.length ? 1 : 0)
