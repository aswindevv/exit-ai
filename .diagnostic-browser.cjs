const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

const base = 'http://127.0.0.1:5173'
const root = process.cwd()

function envNamesAndValuesForRuntimeOnly() {
  const out = {}
  for (const line of fs.readFileSync(`${root}/.env`, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[m[1]] = value
  }
  return out
}

function markdownAccount(role, domain) {
  const readme = fs.readFileSync(`${root}/README.md`, 'utf8')
  const line = readme.split(/\r?\n/).find((x) => new RegExp(`^\\|\\s*${role}\\s*\\|`, 'i').test(x))
  if (!line) throw new Error(`account row missing for ${role}`)
  const cells = line.split('|').map((x) => x.trim()).filter(Boolean)
  return { email: cells[2].replace('$DEMO_EMAIL_DOMAIN', domain), password: cells[3] }
}

function financeAccount() {
  const text = fs.readFileSync(`${root}/CLAUDE.md`, 'utf8')
  const m = text.match(/Finance Anfia \(([^/()]+)\s*\/\s*([^)]+)\)/)
  if (!m) throw new Error('finance account missing')
  return { email: m[1].trim(), password: m[2].trim() }
}

function safeMessage(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"')]+/g, '<url>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<token>')
    .slice(0, 220)
}

async function login(page, account) {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.locator('#login-email').fill(account.email)
  await page.locator('#login-password').fill(account.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForFunction(() => document.querySelector('.sidebar') || document.querySelector('#resign-last-day') || document.querySelector('.login-error'), null, { timeout: 20000 })
  const loginError = await page.locator('.login-error').textContent().catch(() => null)
  if (loginError) throw new Error(`login failed: ${safeMessage(loginError)}`)
}

async function visit(page, route) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  return {
    requested: route,
    actual: new URL(page.url()).pathname,
    heading: await page.locator('h1, h2:not(.sr-only), .card-title').first().textContent().catch(() => null),
    buttons: await page.locator('button').allTextContents(),
  }
}

async function auditRole(browser, role, account, routes, expectedRoot, runRag = false) {
  const context = await browser.newContext({ acceptDownloads: false })
  const page = await context.newPage()
  const consoleErrors = []
  const failedRequests = []
  const apiResponses = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(safeMessage(msg.text()))
  })
  page.on('requestfailed', (req) => {
    const u = new URL(req.url())
    failedRequests.push(`${req.method()} ${u.pathname}: ${safeMessage(req.failure()?.errorText || 'failed')}`)
  })
  page.on('response', (res) => {
    const req = res.request()
    if (!['fetch', 'xhr'].includes(req.resourceType())) return
    const u = new URL(res.url())
    apiResponses.push(`${req.method()} ${u.pathname} -> ${res.status()}`)
  })

  const result = { role, login: false, sessionReload: false, wrongRoleGuard: null, routes: [], rag: null, logout: false }
  try {
    await login(page, account)
    result.login = true
    result.landing = new URL(page.url()).pathname
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('.sidebar'), null, { timeout: 15000 })
    result.sessionReload = true

    const wrong = expectedRoot === '/hr' ? '/manager' : '/hr'
    await page.goto(`${base}${wrong}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    result.wrongRoleGuard = new URL(page.url()).pathname

    for (const route of routes) result.routes.push(await visit(page, route))

    if (runRag) {
      await page.goto(`${base}/employee`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(600)
      const input = page.locator('input[placeholder*="final settlement"]')
      const before = await page.locator('.strip-body').allTextContents()
      await input.fill('When is final settlement processed?')
      await page.getByRole('button', { name: /Ask/ }).click()
      await page.waitForFunction((oldText) => [...document.querySelectorAll('.strip-body')].map((x) => x.textContent).join('|') !== oldText, before.join('|'), { timeout: 90000 })
      const known = await page.locator('.strip-body').allTextContents()
      await input.fill('What is the capital of France?')
      await page.getByRole('button', { name: /Ask/ }).click()
      await page.waitForFunction((oldText) => [...document.querySelectorAll('.strip-body')].map((x) => x.textContent).join('|') !== oldText, known.join('|'), { timeout: 90000 })
      const unknown = await page.locator('.strip-body').allTextContents()
      result.rag = { known: known.map(safeMessage), offTopic: unknown.map(safeMessage) }
    }

    await page.goto(`${base}${expectedRoot}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    await page.locator('.logout-btn').click()
    await page.waitForFunction(() => document.querySelector('#login-email'), null, { timeout: 15000 })
    result.logout = true
  } catch (err) {
    result.error = safeMessage(err.message)
  }
  result.consoleErrors = [...new Set(consoleErrors)]
  result.failedRequests = [...new Set(failedRequests)]
  result.apiResponses = [...new Set(apiResponses)]
  await context.close()
  return result
}

(async () => {
  const env = envNamesAndValuesForRuntimeOnly()
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const [{ data: profiles, error: profileError }, { data: cases, error: caseError }, { data: tasks, error: taskError }] = await Promise.all([
    admin.from('profiles').select('id, role, email, employee_id'),
    admin.from('exit_cases').select('id, employee_id, manager_id, hr_id, status, relieving_letter_issued'),
    admin.from('exit_tasks').select('case_id, stage, status'),
  ])
  if (profileError || caseError || taskError) throw new Error('read-only account discovery failed')
  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]))
  const employeeByNumber = Object.fromEntries(profiles.filter((p) => p.employee_id).map((p) => [p.employee_id, p]))
  const incompleteCase = cases.find((c) => {
    const own = tasks.filter((t) => t.case_id === c.id)
    const stages = ['hr', 'manager', 'it', 'compliance', 'finance']
    return !c.relieving_letter_issued || !stages.every((s) => own.some((t) => t.stage === s) && own.filter((t) => t.stage === s).every((t) => t.status === 'done'))
  })
  const employeeProfile = employeeByNumber[incompleteCase?.employee_id] || employeeByNumber[cases[0]?.employee_id]
  const casedIds = new Set(cases.map((c) => c.employee_id))
  const freshProfile = profiles.find((p) => p.role === 'employee' && p.employee_id && !casedIds.has(p.employee_id))
  const managerProfile = byId[cases.find((c) => c.manager_id)?.manager_id] || profiles.find((p) => p.role === 'manager')
  const hrProfile = byId[cases.find((c) => c.hr_id)?.hr_id] || profiles.find((p) => p.role === 'hr')
  const passwordOf = (role, profile) => role === 'employee'
    ? `${profile.employee_id}${String.fromCharCode(64)}`
    : `${profile.email.split('@')[0]}${String.fromCharCode(64)}${role === 'hr' ? '1' : ''}`
  const accounts = {
    employee: { email: employeeProfile.email, password: passwordOf('employee', employeeProfile) },
    freshEmployee: freshProfile && { email: freshProfile.email, password: passwordOf('employee', freshProfile) },
    manager: { email: managerProfile.email, password: passwordOf('manager', managerProfile) },
    hr: { email: hrProfile.email, password: passwordOf('hr', hrProfile) },
    it: (() => { const p = profiles.find((x) => x.role === 'it'); return { email: p.email, password: passwordOf('it', p) } })(),
    finance: (() => { const p = profiles.find((x) => x.role === 'finance'); return { email: p.email, password: passwordOf('finance', p) } })(),
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })
  const results = []

  const anonymous = await browser.newPage()
  await anonymous.goto(`${base}/hr`, { waitUntil: 'domcontentloaded' })
  await anonymous.waitForTimeout(400)
  results.push({ role: 'anonymous', directRoute: new URL(anonymous.url()).pathname, loginVisible: await anonymous.locator('#login-email').isVisible() })
  await anonymous.close()

  results.push(await auditRole(browser, 'employee', accounts.employee,
    ['/employee', '/employee/my-exit', '/employee/tasks', '/employee/documents', '/employee/knowledge-transfer', '/employee/exit-interview', '/employee/timeline', '/employee/help'], '/employee', true))
  results.push(await auditRole(browser, 'manager', accounts.manager,
    ['/manager', '/manager/my-team', '/manager/exiting-reports', '/manager/kt-approvals', '/manager/clearances', '/manager/timeline', '/manager/help'], '/manager'))
  results.push(await auditRole(browser, 'hr', accounts.hr,
    ['/hr', '/hr/all-exits', '/hr/escalations', '/hr/risk-and-compliance', '/hr/exit-interviews', '/hr/trends', '/hr/clearances', '/hr/reports', '/hr/settings'], '/hr'))
  results.push(await auditRole(browser, 'it', accounts.it,
    ['/it', '/it/deprovisioning', '/it/asset-recovery', '/it/access-reviews', '/it/approvals', '/it/audit-log', '/it/help'], '/it'))
  results.push(await auditRole(browser, 'finance', accounts.finance,
    ['/finance', '/finance/help'], '/finance'))

  const fresh = await browser.newContext()
  const freshPage = await fresh.newPage()
  const freshResult = { role: 'fresh-employee', login: false }
  try {
    if (!accounts.freshEmployee) throw new Error('no uncased employee exists')
    await login(freshPage, accounts.freshEmployee)
    freshResult.login = true
    await freshPage.goto(`${base}/employee`, { waitUntil: 'domcontentloaded' })
    await freshPage.waitForTimeout(700)
    freshResult.actual = new URL(freshPage.url()).pathname
    freshResult.resignationForm = await freshPage.locator('#resign-last-day').isVisible().catch(() => false)
  } catch (err) {
    freshResult.error = safeMessage(err.message)
  }
  results.push(freshResult)
  await fresh.close()

  await browser.close()
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
})().catch((err) => {
  process.stderr.write(`${safeMessage(err.stack || err.message)}\n`)
  process.exitCode = 1
})
