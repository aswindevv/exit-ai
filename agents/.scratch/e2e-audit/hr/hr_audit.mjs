// HR-role Playwright audit script (audit-only, no mutation of real data).
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const SHOT_DIR = 'agents/.scratch/e2e-audit/screenshots/hr'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const consoleErrors = []
const netFailures = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))
page.on('requestfailed', (req) => netFailures.push(`${req.method()} ${req.url()} -- ${req.failure()?.errorText}`))
page.on('response', (res) => { if (res.status() >= 400) netFailures.push(`${res.status()} ${res.request().method()} ${res.url()}`) })

async function shot(name) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true })
}

// --- login ---
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'siva@company.com')
await page.fill('#login-password', 'siva@1')
await page.click('.login-submit')
await page.waitForURL(/\/hr/, { timeout: 10000 })
console.log('LANDED:', page.url())
await shot('01_dashboard')

const routes = ['all-exits', 'risk-and-compliance', 'exit-interviews', 'trends', 'clearances', 'reports', 'settings']
for (const r of routes) {
  await page.goto(`${BASE}/hr/${r}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  console.log('ROUTE', r, '->', page.url())
  await shot(`route_${r.replace(/\W/g, '_')}`)
  const bodyText = await page.locator('body').innerText()
  console.log(`  [len=${bodyText.length}] first200=`, JSON.stringify(bodyText.slice(0, 200)))
}

// --- risk-and-compliance: check risk_level/risk_score actually render ---
await page.goto(`${BASE}/hr/risk-and-compliance`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const riskText = await page.locator('body').innerText()
console.log('RISK PAGE mentions high/medium/low risk:', /high|medium|low/i.test(riskText))
await shot('risk_compliance_detail')

// --- exit-interviews: check sentiment/summary render ---
await page.goto(`${BASE}/hr/exit-interviews`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const interviewText = await page.locator('body').innerText()
console.log('INTERVIEW PAGE text len:', interviewText.length)
await shot('exit_interviews_detail')

// --- all-exits: search/filter/sort probe ---
await page.goto(`${BASE}/hr/all-exits`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const searchBox = page.locator('input[type="search"], input[placeholder*="Search" i], input[placeholder*="search" i]')
const searchCount = await searchBox.count()
console.log('all-exits search input count:', searchCount)
if (searchCount > 0) {
  await searchBox.first().fill('Emp001')
  await page.waitForTimeout(500)
  const filteredText = await page.locator('body').innerText()
  console.log('after search "Emp001", body mentions Emp001:', filteredText.includes('Emp001'))
  await shot('all_exits_search_emp001')
}
const selects = page.locator('select')
console.log('all-exits <select> filter count:', await selects.count())
const allButtons = page.locator('button, a[role="button"], a.nav, [onclick]')
console.log('all-exits total clickable elements:', await allButtons.count())

// --- inventory every button/link on each HR page ---
const buttonInventory = {}
for (const r of ['', ...routes]) {
  const url = r ? `${BASE}/hr/${r}` : `${BASE}/hr`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const buttons = await page.locator('button').allInnerTexts()
  const links = await page.locator('a').allInnerTexts()
  buttonInventory[r || 'dashboard'] = { buttons, links }
}
console.log('BUTTON_INVENTORY', JSON.stringify(buttonInventory, null, 2))

// --- unauthorized-route probe: try /manager and /it while logged in as HR ---
await page.goto(`${BASE}/manager`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
console.log('after navigating to /manager as HR, ended up at:', page.url())
await shot('unauthorized_manager_attempt')

await page.goto(`${BASE}/it`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
console.log('after navigating to /it as HR, ended up at:', page.url())
await shot('unauthorized_it_attempt')

// --- logout ---
await page.goto(`${BASE}/hr`, { waitUntil: 'networkidle' })
const logoutBtn = page.locator('.logout-btn')
console.log('logout button count:', await logoutBtn.count())
if (await logoutBtn.count() > 0) {
  await logoutBtn.first().click()
  await page.waitForTimeout(800)
  console.log('after logout click, url:', page.url())
  const loginVisible = await page.locator('#login-email').count()
  console.log('login form visible after logout:', loginVisible > 0)
  await shot('after_logout')
}

console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors))
console.log('NET_FAILURES', JSON.stringify(netFailures))

await browser.close()
console.log('HR AUDIT SCRIPT DONE')
