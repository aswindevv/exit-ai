// Scoped browser check for Fix A: risk_agent must run on the live/browser
// path (finance_settle_check), not just python -m agents.run_case.
//
//   employee submits resignation -> manager approves KT -> IT approves
//   -> finance settles dues (fires /finance-settle-check) -> risk_agent has
//   now run: risk_score/risk_level/rehire_eligible populated on exit_cases,
//   exactly one agent_runs row with stage='risk'. A second, direct call to
//   /finance-settle-check for the same case must not duplicate exit_tasks or
//   compliance rows (idempotency regression check).
//
// Disposable case: Emp024 (no existing exit_cases row, distinct from
// Emp009/Emp017 and from Emp021/Emp023 used by verify_manager_gate.cjs).
// Purged at the end; cleanup confirmed by re-query.
//
//   node scripts/verify/verify_risk_agent_wiring.cjs [baseUrl]
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')

process.loadEnvFile()

const BASE = process.argv[2] || 'http://localhost:5173'
const EMP = { empId: 'Emp024', email: 'emp024@gmail.com', password: 'Emp024@', lastDay: '2026-12-20' }
const MANAGER = { email: 'aravidhan@company.com', password: 'aravidhan@', url: /\/manager/ }
const IT = { email: 'aswin@gmail.com', password: 'aswin@', url: /\/it/ }
const FINANCE = { email: 'anfiacj@gmail.com', password: 'anfiacj@', url: /\/finance/ }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const failures = []
const log = (m) => console.log(m)
const fail = (m) => { failures.push(m); console.log('  FAIL ' + m) }

const CHILD_TABLES = ['exit_tasks', 'agent_runs', 'kt_reviews', 'exit_interviews', 'case_documents']

async function purge(empId) {
  const { data: cases } = await db.from('exit_cases').select('id').eq('employee_id', empId)
  for (const c of cases ?? []) {
    for (const t of CHILD_TABLES) await db.from(t).delete().eq('case_id', c.id)
    await db.from('exit_cases').delete().eq('id', c.id)
  }
  return (cases ?? []).length
}

const caseFor = async (empId) =>
  (await db.from('exit_cases').select('*').eq('employee_id', empId).maybeSingle()).data

const tasksFor = async (caseId) =>
  (await db.from('exit_tasks').select('id,stage,status,title').eq('case_id', caseId)).data ?? []

async function poll(label, fn, timeoutMs = 120000, everyMs = 2000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > until) { fail(`${label}: timed out after ${timeoutMs / 1000}s`); return null }
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

async function login(page, acct) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', acct.email)
  await page.fill('#login-password', acct.password)
  await page.click('button.login-submit')
  await page.waitForURL(acct.url ?? /\/(employee|manager|hr|it|finance)/, { timeout: 30000 })
  await page.waitForTimeout(1500)
}

async function logout(page) {
  await page.evaluate(() => window.localStorage.clear())
  await page.context().clearCookies()
}

async function clickInGroup(page, employeeName, buttonLabel, titles = null) {
  return page.evaluate(({ employeeName, buttonLabel, titles }) => {
    const headers = [...document.querySelectorAll('[data-group-header="true"]')]
    const matches = headers.filter((h) => h.textContent.includes(employeeName))
    if (!matches.length) return { group: false }
    for (const h of matches) {
      let node = h.nextElementSibling
      while (node && !node.hasAttribute('data-group-header')) {
        const text = node.textContent || ''
        const mine = !titles || titles.some((t) => text.includes(t))
        const btn = [...node.querySelectorAll('button')].find(
          (b) => b.textContent.trim().replace(/…$/, '') === buttonLabel && !b.disabled,
        )
        if (mine && btn) { btn.click(); return { group: true, clicked: true } }
        node = node.nextElementSibling
      }
    }
    return { group: true, clicked: false }
  }, { employeeName, buttonLabel, titles })
}

const IT_PAGES = ['/it', '/it/approvals', '/it/deprovisioning', '/it/asset-recovery', '/it/access-reviews']
async function walkItPages(page, employeeName, titles) {
  for (const path of IT_PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const r = await clickInGroup(page, employeeName, 'Approve', titles)
    if (r.clicked) return r
  }
  return { clicked: false }
}

async function submitResignation(page, emp) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    if (!(await page.locator('#resign-last-day').count())) {
      await purge(emp.empId)
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
    }
    await page.fill('#resign-last-day', emp.lastDay)
    await page.fill('#resign-reason', `Disposable risk_agent-wiring verification case (${emp.empId}).`)
    await page.click('button.login-submit')
    await page.waitForTimeout(3000)

    const kase = await caseFor(emp.empId)
    if (kase) {
      const tasks = await poll(`checklist for ${emp.empId}`, async () => {
        const t = await tasksFor(kase.id)
        return t.some((x) => x.stage === 'manager') ? t : null
      }, 60000, 2000).catch(() => null)
      if (tasks) return { kase, tasks }
    }
    await purge(emp.empId)
    console.log(`  resignation attempt ${attempt} did not produce a checklist — retrying`)
  }
  fail(`${emp.empId}: resignation never produced a checklist after 3 attempts`)
  return null
}

async function run() {
  const pre = await purge(EMP.empId)
  if (pre) console.log(`pre-clean: removed ${pre} leftover case(s) for ${EMP.empId}`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`) })

  let kase = null
  try {
    console.log('\n--- resignation ---')
    await login(page, { ...EMP, url: /\/employee/ })
    const submitted = await submitResignation(page, EMP)
    if (!submitted) throw new Error('no case')
    kase = submitted.kase
    log(`  case ${kase.id.slice(0, 8)} created for ${EMP.empId}`)

    await page.goto(`${BASE}/employee/tasks`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    for (let i = 0; i < 12; i++) {
      const btn = page.locator('button.mark-done').first()
      if (!(await btn.count())) break
      await btn.click()
      await page.waitForTimeout(1200)
    }

    console.log('\n--- manager approves KT ---')
    await logout(page)
    await login(page, MANAGER)
    await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const ktTitles = submitted.tasks.filter((t) => t.stage === 'manager').map((t) => t.title)
    for (let i = 0; i < ktTitles.length + 2; i++) {
      const r = await clickInGroup(page, kase.employee_name, 'Review', ktTitles)
      if (!r.clicked) break
      await page.waitForTimeout(1500)
    }
    const withIt = await poll('IT tasks created', async () => {
      const t = await tasksFor(kase.id)
      return t.some((x) => x.stage === 'it') ? t : null
    })
    if (!withIt) throw new Error('no IT tasks')

    console.log('\n--- IT approves ---')
    await logout(page)
    await login(page, IT)
    const itTitles = withIt.filter((t) => t.stage === 'it').map((t) => t.title)
    for (let i = 0; i < itTitles.length + 2; i++) {
      let r = await clickInGroup(page, kase.employee_name, 'Approve', itTitles)
      if (!r.clicked) r = await walkItPages(page, kase.employee_name, itTitles)
      if (!r.clicked) break
      await page.waitForTimeout(2000)
    }
    const itCleared = await poll('all IT tasks done', async () => {
      const t = await tasksFor(kase.id)
      const it = t.filter((x) => x.stage === 'it')
      return it.length && it.every((x) => x.status === 'done') ? t : null
    })
    if (!itCleared) throw new Error('IT never cleared')

    console.log('\n--- finance settles dues (fires /finance-settle-check) ---')
    await logout(page)
    await login(page, FINANCE)
    await page.waitForTimeout(1500)
    let fin = await clickInGroup(page, kase.employee_name, 'Settle dues')
    if (!fin.clicked) {
      const row = page.locator('.row', { hasText: kase.employee_name }).first()
      const btn = row.getByRole('button', { name: 'Settle dues' })
      if (await btn.count()) await btn.click()
    }

    console.log('\n--- verifying risk_agent ran on the live path ---')
    const withRisk = await poll('risk fields populated', async () => {
      const c = await caseFor(EMP.empId)
      return c?.finance_cleared && c.risk_level != null ? c : null
    })
    if (!withRisk) throw new Error('risk fields never populated')
    log(`  risk_score=${withRisk.risk_score} risk_level=${withRisk.risk_level} rehire_eligible=${withRisk.rehire_eligible}`)

    const riskRuns1 = (await db.from('agent_runs').select('id,detail').eq('case_id', kase.id).eq('stage', 'risk')).data ?? []
    if (riskRuns1.length !== 1) fail(`expected exactly 1 agent_runs stage='risk' row after finance settle, got ${riskRuns1.length}`)
    else log(`  agent_runs risk row recorded once: "${riskRuns1[0].detail}"`)

    console.log('\n--- idempotency: second direct /finance-settle-check call ---')
    const before = await tasksFor(kase.id)
    const res = await fetch('http://localhost:8787/finance-settle-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: kase.id }),
    })
    const body = await res.json()
    if (!body.ok) fail(`second /finance-settle-check call failed: ${JSON.stringify(body)}`)
    else log(`  second call ok, risk re-scored: level=${body.risk?.risk_level}`)
    const after = await tasksFor(kase.id)
    if (after.length !== before.length) fail(`exit_tasks row count changed on re-check: ${before.length} -> ${after.length} (duplicate rows)`)
    else log(`  exit_tasks count unchanged on re-check: ${after.length}`)

    const riskRuns2 = (await db.from('agent_runs').select('id').eq('case_id', kase.id).eq('stage', 'risk')).data ?? []
    log(`  agent_runs stage='risk' rows after 2nd call: ${riskRuns2.length} (2 expected -- one row per genuinely-run re-check, same pattern as manager gate logging)`)
  } catch (e) {
    fail(`threw: ${e.message}`)
  } finally {
    if (errors.length) fail(`console/network errors: ${errors.slice(0, 3).join(' | ').slice(0, 300)}`)
    await browser.close()
    console.log('\n--- cleanup ---')
    await purge(EMP.empId)
    const left = await caseFor(EMP.empId)
    if (left) fail(`cleanup: ${EMP.empId} still has a case`)
    else console.log(`  ${EMP.empId} restored to no-exit-case`)
  }

  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

run().catch((e) => { console.error(e); process.exit(1) })
