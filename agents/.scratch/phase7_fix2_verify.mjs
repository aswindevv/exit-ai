// Phase 7 fix #2: a CLI/graph-created escalation (agents.supervisor._escalate)
// must be HR-actionable -- previously escalation_state was left NULL, so
// HR's Re-route/Resolve UPDATE (.eq('escalation_state','open')) never
// matched the row. Disposable case: Emp022 (no real exit_cases row before
// this test), escalated via the real CLI path (python -m agents.supervisor
// <case_id> --reject). The 20 real cases are untouched.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill('siva@company.com')
await page.locator('#login-password').fill('siva@1')
await page.locator('button.login-submit').click()
await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
await page.waitForLoadState('networkidle')

await page.goto(`${BASE}/hr/escalations`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

const row = page.locator('.row:has-text("Priya Nair")')

const results = []
function record(name, pass, detail) { results.push({ name, pass, detail }) }

record('escalation row visible for CLI-created case', await row.count() === 1, `count=${await row.count()}`)

const rerouteBtn = row.getByRole('button', { name: /Re-route to manager/i })
const resolveBtn = row.getByRole('button', { name: /Resolve\/Close/i })
record('Re-route button present (row is actionable, not stuck)', await rerouteBtn.count() === 1, `count=${await rerouteBtn.count()}`)
record('Resolve button present', await resolveBtn.count() === 1, `count=${await resolveBtn.count()}`)

// Click Resolve and confirm the real RLS-gated UPDATE actually succeeds --
// this is the exact action that silently no-op'd against a NULL row before.
await resolveBtn.click()
await page.waitForTimeout(1500)

const resolvedTag = row.locator('.tag')
const tagText = await resolvedTag.first().innerText().catch(() => '(none)')
const errorText = await row.locator('.c-danger.sub').first().innerText().catch(() => null)

record('resolve action succeeded (no "Already handled" error)', errorText === null, `error="${errorText}"`)
record('row now shows Resolved tag', tagText === 'Resolved', `tag="${tagText}"`)

await browser.close()

const failures = results.filter((r) => !r.pass)
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} -- ${r.detail}`)
process.exit(failures.length ? 1 : 0)
