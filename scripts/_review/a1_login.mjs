import { chromium } from 'playwright'
import { APP, ACCOUNTS, employee, login, trackErrors } from './lib.mjs'
const SHOTS = 'scripts/_review/shots/'

const NAV = {
  employee: ['', 'my-exit', 'tasks', 'documents', 'knowledge-transfer', 'exit-interview', 'timeline', 'help'],
  manager:  ['', 'my-team', 'exiting-reports', 'kt-approvals', 'clearances', 'timeline', 'help'],
  it:       ['', 'deprovisioning', 'asset-recovery', 'access-reviews', 'approvals', 'audit-log', 'help'],
  hr:       ['', 'all-exits', 'escalations', 'risk-and-compliance', 'exit-interviews', 'trends', 'clearances', 'policy-audit', 'reports', 'agent-activity', 'settings'],
  finance:  ['', 'help'],
}
const ROOTS = ['/hr', '/manager', '/it', '/finance', '/employee']
const EMPTY_RX = /(no results|no cases|nothing|none yet|no data|no tasks|no exits|empty|not available|coming soon|no records|no interviews|no alerts|no activity|no escalations)/i

async function settle(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }) } catch {}
  await page.waitForTimeout(900)
}

async function runRole(browser, tag, email, password, expectRole, navKey, expectLanding) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await ctx.newPage()
  const errs = trackErrors(page)
  const out = { tag, email, expectLanding }
  await login(page, email, password)
  await settle(page)
  out.landedUrl = page.url()
  out.sidebarRole = await page.locator('.sidebar .user-meta .role').first().textContent().catch(() => null)
  out.sidebarName = await page.locator('.sidebar .user-meta .name').first().textContent().catch(() => null)
  out.sidebarNav = await page.locator('.sidebar .nav a').allTextContents().catch(() => [])
  out.loginErrs = [...errs]
  await page.screenshot({ path: `${SHOTS}a1_${tag}_landing.png`, fullPage: false })

  // nav routes
  out.routes = []
  if (navKey) {
    for (const seg of NAV[navKey]) {
      const before = errs.length
      const url = `${APP}/${navKey}${seg ? '/' + seg : ''}`
      let nav = 'ok'
      try { await page.goto(url, { waitUntil: 'domcontentloaded' }) } catch (e) { nav = 'GOTO-ERR ' + e.message.slice(0, 120) }
      await settle(page)
      const finalUrl = page.url()
      const hasShell = await page.locator('.shell').count()
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const newErrs = errs.slice(before)
      out.routes.push({
        seg: seg || '(index)', url, finalUrl, nav, hasShell,
        textLen: body.length,
        emptyHint: EMPTY_RX.test(body) ? (body.match(EMPTY_RX) || [])[0] : null,
        head: body.slice(0, 160),
        errs: newErrs,
      })
    }
  }

  // cross-role roots
  out.cross = []
  for (const root of ROOTS) {
    const before = errs.length
    try { await page.goto(APP + root, { waitUntil: 'domcontentloaded' }) } catch {}
    await settle(page)
    const role = await page.locator('.sidebar .user-meta .role').first().textContent().catch(() => null)
    out.cross.push({ root, finalUrl: page.url(), renderedRole: role, errs: errs.slice(before) })
  }
  out.totalErrs = errs.length
  out.allErrs = [...new Set(errs)]
  await ctx.close()
  return out
}

const browser = await chromium.launch()
const results = []
const e21 = employee('Emp021')
results.push(await runRole(browser, 'employee_Emp021_nocase', e21.email, e21.password, 'employee', null, '/employee/resignation'))
const e22 = employee('Emp022')
results.push(await runRole(browser, 'employee_Emp022_hascase', e22.email, e22.password, 'employee', 'employee', '/employee'))
for (const k of ['hr', 'manager', 'it', 'finance']) {
  const a = ACCOUNTS[k]
  results.push(await runRole(browser, k, a.email, a.password, k, k, a.landing))
}
await browser.close()
console.log(JSON.stringify(results, null, 1))
