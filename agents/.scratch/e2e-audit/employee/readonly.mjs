// Employee audit pass 1: read-only exploration of an already-exiting real
// account (Emp002, one of the 20 real seeded exit_cases -- never mutated),
// full route sweep, console/network capture, unauthorized-route probe,
// logout, and a direct REST RLS probe for HR-only fields using the same
// anon key + session token the app itself uses.
import { chromium } from 'playwright'
import fs from 'fs'

const BASE = 'http://localhost:5173'
const env = fs.readFileSync('.env', 'utf8')
const SUPABASE_URL = env.match(/VITE_SUPABASE_URL=(.+)/)[1].trim()
const ANON_KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()

const results = { routes: {}, consoleErrors: [], networkFailures: [], unauthorizedRedirects: {}, rlsProbe: null }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') results.consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => results.consoleErrors.push('pageerror: ' + err.message))
page.on('response', (res) => { if (res.status() >= 400) results.networkFailures.push(`${res.status()} ${res.request().method()} ${res.url()}`) })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'emp002@gmail.com')
await page.fill('#login-password', 'Emp002@')
await page.click('.login-submit')
await page.waitForURL(/\/employee/, { timeout: 10000 })
results.landingUrl = page.url()

const ROUTES = ['', 'my-exit', 'tasks', 'documents', 'knowledge-transfer', 'exit-interview', 'timeline', 'help']
for (const r of ROUTES) {
  await page.goto(`${BASE}/employee/${r}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const bodyText = await page.locator('body').innerText()
  results.routes[r || '(dashboard)'] = {
    url: page.url(),
    blank: bodyText.trim().length < 10,
    snippet: bodyText.slice(0, 120).replace(/\n/g, ' '),
  }
  await page.screenshot({ path: `agents/.scratch/e2e-audit/screenshots/employee/route_${r || 'dashboard'}.png` })
}

// Unauthorized-route probe: try other roles' URL prefixes while logged in as employee.
for (const foreign of ['hr', 'manager', 'it', 'finance']) {
  await page.goto(`${BASE}/${foreign}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  results.unauthorizedRedirects[foreign] = page.url()
}

// Logout: find the logout button via its class (see dashboards.css .logout-btn).
await page.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
const logoutBtn = page.locator('.logout-btn')
results.logoutButtonVisible = await logoutBtn.count() > 0
if (results.logoutButtonVisible) {
  await logoutBtn.click()
  await page.waitForTimeout(500)
  results.afterLogoutUrl = page.url()
  results.loginFormVisibleAfterLogout = await page.locator('#login-email').count() > 0
}

// RLS probe: pull the session token the app itself stored, then hit the
// REST API directly for exit_cases + case_documents to check what an
// employee's own RLS actually returns for HR-only-style columns.
await page.goto(BASE, { waitUntil: 'networkidle' }) // logged out now, re-login for probe
await page.fill('#login-email', 'emp002@gmail.com')
await page.fill('#login-password', 'Emp002@')
await page.click('.login-submit')
await page.waitForURL(/\/employee/, { timeout: 10000 })

const token = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (k.includes('auth-token')) {
      const v = JSON.parse(localStorage.getItem(k))
      return v.access_token
    }
  }
  return null
})

async function probe(table, select) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  })
  const body = await res.json()
  return { status: res.status, body }
}

results.rlsProbe = {
  base_table_exit_cases: await probe('exit_cases', 'id,employee_id,risk_level,risk_score,rehire_eligible'),
  employee_exit_view: await probe('employee_exit_view', '*'),
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
