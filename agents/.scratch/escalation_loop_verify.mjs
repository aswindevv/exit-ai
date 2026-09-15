// Disposable-data verification for the full escalation loop (reject-with-reason
// + HR re-route/resolve). Drives the real dev server (5173) + real agent
// service (8787) + real DB. Disposable case: Aiden Nair / emp021@gmail.com
// (case 34a2dd28-5fd1-4a36-8036-4726cbcf0dc5, task
// c5c4e4b3-e1fe-4348-ab71-af8993fc627f). Does NOT touch any of the 20 real
// exit_cases or the 3 real pre-existing escalations (Mason Sharma / Ishaan
// Patel / Diya Sharma).
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

// Loaded from .env at runtime so the anon key/URL never appear in transcript
// or terminal output -- values are used only inside page.evaluate() calls.
const envText = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
const envVar = (name) => envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim()
const SUPA_URL = envVar('VITE_SUPABASE_URL')
const SUPA_ANON_KEY = envVar('VITE_SUPABASE_ANON_KEY')

const BASE = 'http://localhost:5173'
const DISPOSABLE_TASK_TITLE = 'KT handover with manager (disposable test)'
const REASON_1 = 'KT doc missing rollback steps for the billing job (disposable test)'
const REASON_2 = 'Still missing the on-call handover doc (disposable test)'

const browser = await chromium.launch({ headless: true })
const results = {}
const consoleErrors = []

async function newLoggedInPage(email, password, roleRegex) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL(roleRegex, { timeout: 10000 })
  return { context, page }
}

// --- Part A: manager rejects WITH a reason ---
{
  const { page } = await newLoggedInPage('aravidhan@company.com', 'aravidhan@', /\/manager/)
  await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
  await page.evaluate((reason) => { window.prompt = () => reason }, REASON_1)
  const row = page.locator('.row', { hasText: DISPOSABLE_TASK_TITLE })
  await row.waitFor({ timeout: 10000 })
  await row.locator('button', { hasText: 'Reject' }).click()
  await page.waitForResponse((r) => r.url().includes('/reject-manager-task'), { timeout: 10000 })
  await page.waitForTimeout(1000)
  const bodyText = await page.locator('body').innerText()
  results.partA_button_suppressed_after_reject = bodyText.includes('Escalated to HR')
}

// --- Part A2: RLS negative test -- manager (not HR) tries the exact same
// transition HR's buttons perform, directly against the REST API with their
// own session token. Must be rejected (0 rows affected), proving "only HR
// can resolve/re-route" is enforced by Postgres, not just hidden buttons.
{
  const { page } = await newLoggedInPage('aravidhan@company.com', 'aravidhan@', /\/manager/)
  const rlsResult = await page.evaluate(async ({ url, anonKey }) => {
    const authKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    const session = JSON.parse(localStorage.getItem(authKey))
    const resp = await fetch(`${url}/rest/v1/exit_tasks?id=eq.c5c4e4b3-e1fe-4348-ab71-af8993fc627f`, {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ escalation_state: 'resolved' }),
    })
    const data = await resp.json().catch(() => null)
    return { status: resp.status, rowsAffected: Array.isArray(data) ? data.length : null }
  }, { url: SUPA_URL, anonKey: SUPA_ANON_KEY })
  results.partA2_manager_cannot_resolve_directly = rlsResult.status === 403 || rlsResult.rowsAffected === 0
  results.partA2_raw = rlsResult
}

// --- Part B: HR sees the real reason ---
{
  const { page } = await newLoggedInPage('siva@company.com', 'siva@1', /\/hr/)
  await page.goto(`${BASE}/hr/escalations`, { waitUntil: 'networkidle' })
  const bodyText = await page.locator('body').innerText()
  results.partB_real_reason_shown = bodyText.includes(REASON_1)
  results.partB_realcases_still_not_captured = bodyText.includes('Not captured')
  results.partB_reroute_button_present = (await page.locator('button', { hasText: 'Re-route to manager' }).count()) > 0
  results.partB_resolve_button_present = (await page.locator('button', { hasText: 'Resolve/Close' }).count()) > 0
}

// --- Part C: HR clicks Re-route on the disposable row ---
{
  const { page } = await newLoggedInPage('siva@company.com', 'siva@1', /\/hr/)
  await page.goto(`${BASE}/hr/escalations`, { waitUntil: 'networkidle' })
  const row = page.locator('.row', { hasText: 'Aiden Nair' })
  await row.locator('button', { hasText: 'Re-route to manager' }).click()
  await page.waitForTimeout(1500)
  const bodyText = await page.locator('body').innerText()
  const rerouteRow = page.locator('.row', { hasText: 'Aiden Nair' })
  results.partC_state_flips_to_rerouted = (await rerouteRow.innerText()).includes('Sent back to manager')
  results.partC_no_console_errors_yet = consoleErrors.length === 0
}

// --- Part D: manager sees the case actionable again after reroute ---
{
  const { page } = await newLoggedInPage('aravidhan@company.com', 'aravidhan@', /\/manager/)
  await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
  const row = page.locator('.row', { hasText: DISPOSABLE_TASK_TITLE })
  await row.waitFor({ timeout: 10000 })
  results.partD_review_button_reappears = (await row.locator('button', { hasText: 'Review' }).count()) > 0
  results.partD_reject_button_reappears = (await row.locator('button', { hasText: 'Reject' }).count()) > 0
  results.partD_no_stale_escalated_tag = !(await row.innerText()).includes('Escalated to HR')

  // manager rejects again -> must REOPEN same escalation row, not duplicate
  await page.evaluate((reason) => { window.prompt = () => reason }, REASON_2)
  await row.locator('button', { hasText: 'Reject' }).click()
  await page.waitForResponse((r) => r.url().includes('/reject-manager-task'), { timeout: 10000 })
  await page.waitForTimeout(1000)
}

// --- Part E: HR sees the reopened escalation with the NEW reason, resolves it ---
{
  const { page } = await newLoggedInPage('siva@company.com', 'siva@1', /\/hr/)
  await page.goto(`${BASE}/hr/escalations`, { waitUntil: 'networkidle' })
  let bodyText = await page.locator('body').innerText()
  results.partE_reopened_with_new_reason = bodyText.includes(REASON_2)
  results.partE_no_duplicate_row = (await page.locator('.row', { hasText: 'Aiden Nair' }).count()) === 1

  const row = page.locator('.row', { hasText: 'Aiden Nair' })
  await row.locator('button', { hasText: 'Resolve/Close' }).click()
  await page.waitForTimeout(1500)
  bodyText = await (page.locator('.row', { hasText: 'Aiden Nair' })).innerText()
  results.partE_resolves = bodyText.includes('Resolved')
  results.partE_no_actions_after_resolve =
    (await row.locator('button', { hasText: 'Re-route to manager' }).count()) === 0 &&
    (await row.locator('button', { hasText: 'Resolve/Close' }).count()) === 0
}

console.log('RESULTS:', JSON.stringify(results, null, 2))
console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors))
await browser.close()
console.log('VERIFY_SCRIPT_DONE')
