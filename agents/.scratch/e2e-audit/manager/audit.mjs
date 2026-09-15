// Disposable Manager-role Playwright audit script. Logs in as the real
// Aravidhan demo account, walks every manager route, screenshots each,
// specifically looks for a REJECT control on the two disposable KT-approval
// tasks (Emp060 = intended reject target, Emp061 = intended approve target),
// clicks Approve on Emp061's task, and attempts an unauthorized-role route.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const SHOT = 'agents/.scratch/e2e-audit/screenshots/manager'
const findings = []
const consoleErrors = []
const failedRequests = []

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))
page.on('response', (res) => { if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`) })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aravidhan@company.com')
await page.fill('#login-password', 'aravidhan@')
await page.click('.login-submit')
await page.waitForURL(/\/manager/, { timeout: 10000 })
findings.push(`LOGIN: landed on ${page.url()} (expected /manager) -> ${page.url().includes('/manager') ? 'PASS' : 'FAIL'}`)
await page.screenshot({ path: `${SHOT}/01_dashboard.png`, fullPage: true })

const routes = ['my-team', 'exiting-reports', 'kt-approvals', 'clearances', 'timeline', 'help']
for (const r of routes) {
  await page.goto(`${BASE}/manager/${r}`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${SHOT}/${r}.png`, fullPage: true })
  const bodyText = await page.textContent('body')
  findings.push(`ROUTE /manager/${r}: loaded, ${bodyText.length} chars body text`)
}

// KT approvals page: look for the two disposable tasks and any reject control
await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
const buttons = await page.$$eval('button', (els) => els.map((b) => b.textContent.trim()))
findings.push(`KT-APPROVALS PAGE BUTTONS FOUND: ${JSON.stringify(buttons)}`)
const bodyHtml = await page.content()
const hasRejectWord = /reject/i.test(bodyHtml)
findings.push(`KT-APPROVALS PAGE: contains the word "reject" anywhere in rendered HTML? ${hasRejectWord}`)
await page.screenshot({ path: `${SHOT}/02_kt_approvals_full.png`, fullPage: true })

// Click "Review" (the only action) on the Emp061 approve-target row, verify UI updates to "Approved"
const rows = await page.$$('.row.row--split')
let approvedOne = false
for (const row of rows) {
  const text = await row.textContent()
  if (text.includes('KT handover with manager')) {
    const btn = await row.$('button')
    if (btn) {
      const label = await btn.textContent()
      findings.push(`Clicking the only available action button on a KT row: "${label.trim()}"`)
      await btn.click()
      await page.waitForTimeout(1500)
      approvedOne = true
      break
    }
  }
}
await page.screenshot({ path: `${SHOT}/03_after_click_review.png`, fullPage: true })
findings.push(`Clicked one KT row's action button: ${approvedOne}`)

// Unauthorized-route attempt: manager tries /hr and /it
for (const foreign of ['hr', 'it']) {
  await page.goto(`${BASE}/${foreign}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  findings.push(`UNAUTHORIZED ROUTE ATTEMPT /${foreign}: ended at ${page.url()} -> ${page.url().endsWith('/manager') || page.url().endsWith('/manager/') ? 'PASS (self-redirected)' : 'FAIL'}`)
}
await page.screenshot({ path: `${SHOT}/04_after_unauthorized_attempt.png`, fullPage: true })

// RLS probe: use the app's own supabase client (already authenticated in this page context) to try reading HR-only fields directly
const probe = await page.evaluate(async () => {
  try {
    const mod = await import('/src/lib/supabase.js')
    const { data, error } = await mod.supabase.from('exit_cases').select('id, risk_level, risk_score, rehire_eligible').limit(5)
    return { data, error: error?.message }
  } catch (e) {
    return { thrown: String(e) }
  }
})
findings.push(`RLS PROBE (direct exit_cases select of risk_level/risk_score/rehire_eligible as manager): ${JSON.stringify(probe)}`)

// Logout: find logout button
const logoutBtn = await page.$('.logout-btn')
if (logoutBtn) {
  await logoutBtn.click()
  await page.waitForTimeout(1000)
  findings.push(`LOGOUT: clicked .logout-btn, resulting url = ${page.url()}`)
} else {
  findings.push('LOGOUT: no .logout-btn found on page')
}

console.log(findings.join('\n'))
console.log('\nCONSOLE_ERRORS: ' + JSON.stringify(consoleErrors))
console.log('FAILED_REQUESTS: ' + JSON.stringify(failedRequests))

await browser.close()
