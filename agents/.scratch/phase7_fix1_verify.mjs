// Phase 7 fix #1 verification: IT dashboard must render a verification_failed
// task distinctly from a verified one, both currently status='done'.
// Uses the disposable QA-P7 case (Emp021, no real exit_cases row before this
// test) inserted directly via SQL -- the 20 real Emp001-020 cases are untouched.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill('aswin@gmail.com')
await page.locator('#login-password').fill('aswin@')
await page.locator('button.login-submit').click()
await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
await page.waitForLoadState('networkidle')
await page.waitForTimeout(1500)

const queue = page.locator('.card:has(.card-title:text-is("Deprovisioning queue"))')
const verifiedRow = queue.locator('.row:has-text("QA-P7 verified laptop return")')
const failedRow = queue.locator('.row:has-text("QA-P7 failed SSO revoke")')

const results = []
function record(name, pass, detail) { results.push({ name, pass, detail }) }

record('on IT dashboard', page.url().includes('/it'), page.url())
record('verified test row visible', await verifiedRow.count() === 1, `count=${await verifiedRow.count()}`)
record('failed test row visible', await failedRow.count() === 1, `count=${await failedRow.count()}`)

const verifiedTag = await verifiedRow.locator('.tag').first().innerText().catch(() => '(none)')
const verifiedClass = await verifiedRow.locator('.tag').first().getAttribute('class').catch(() => '(none)')
const failedTag = await failedRow.locator('.tag').first().innerText().catch(() => '(none)')
const failedClass = await failedRow.locator('.tag').first().getAttribute('class').catch(() => '(none)')

record('verified row shows Done', verifiedTag === 'Done', `tag="${verifiedTag}" class="${verifiedClass}"`)
record('verified row tone is success', verifiedClass?.includes('t-success'), verifiedClass)
record('failed row does NOT show Done', failedTag !== 'Done', `tag="${failedTag}" class="${failedClass}"`)
record('failed row is visually distinct (t-danger)', failedClass?.includes('t-danger'), failedClass)
record('verified vs failed labels differ', verifiedTag !== failedTag, `verified="${verifiedTag}" failed="${failedTag}"`)

await browser.close()

const failures = results.filter((r) => !r.pass)
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} -- ${r.detail}`)
process.exit(failures.length ? 1 : 0)
