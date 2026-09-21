// Scoped browser check for the HR "Policy audit" view (agent #22).
//
// Read-only: no rows are created, updated or deleted. The counts/breakdown/
// breach-detail are computed LIVE from exit_cases/exit_tasks/agent_runs (see
// src/lib/policyAudit.js) -- not read from the stored analytics_insights row,
// which would otherwise show whatever was true whenever the CLI auditor last
// ran. This script recomputes the same live numbers independently (its own
// port of auditCases()) and diffs them against the page. Only the
// recommendation narrative comes from the stored row, and is asserted
// against that row's own text -- and #14's row must still drive Reports, so
// the two agents' rows in the same table are not being confused.
//
//   node scripts/verify/verify_policy_audit_view.cjs [baseUrl]
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

process.loadEnvFile()

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = 'scripts/clearance_screens'
const HR = { email: 'siva@company.com', password: 'siva@1' }
const AUDITOR_TYPE = 'policy_compliance_auditor'
const CHECKS = ['sla_breach', 'missing_approval', 'skipped_step']
const CHECK_LABEL = { sla_breach: 'SLA breach', missing_approval: 'Missing approval', skipped_step: 'Skipped step' }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const failures = []
const fail = (m) => { failures.push(m); console.log('  FAIL ' + m) }
const pass = (m) => console.log('  ok   ' + m)

const latest = async (type) =>
  (await db.from('analytics_insights').select('*').eq('agent_type', type)
    .order('created_at', { ascending: false }).limit(1)).data?.[0] ?? null

// Independent port of src/lib/policyAudit.js::auditCases -- same 3 checks,
// same 5-day threshold -- so this script doesn't just re-import the code
// under test.
const ACTIVE_STATUSES = new Set(['open', 'in_progress'])
const THRESHOLD_DAYS = 5
async function liveAudit() {
  const today = new Date(new Date().toDateString())
  const { data: cases } = await db.from('exit_cases').select('id,status')
  const { data: tasks } = await db.from('exit_tasks').select('id,case_id,stage,status,due_date')
  const { data: approvedRuns } = await db.from('agent_runs').select('case_id').eq('stage', 'manager').eq('detail', 'approved')
  const approved = new Set((approvedRuns ?? []).map((r) => r.case_id))
  const byCase = {}
  for (const t of tasks ?? []) (byCase[t.case_id] ??= []).push(t)

  const active = (cases ?? []).filter((c) => ACTIVE_STATUSES.has(c.status))
  const breachesByCheck = { sla_breach: 0, missing_approval: 0, skipped_step: 0 }
  let breachCount = 0
  for (const c of active) {
    const caseTasks = byCase[c.id] ?? []
    const stages = new Set(caseTasks.map((t) => t.stage))
    for (const t of caseTasks) {
      if (t.status !== 'pending' || !t.due_date) continue
      const daysOverdue = Math.round((today - new Date(t.due_date)) / 86400000)
      if (daysOverdue >= THRESHOLD_DAYS) { breachesByCheck.sla_breach++; breachCount++ }
    }
    const progressed = stages.has('it') || stages.has('finance')
    if (progressed && !approved.has(c.id)) { breachesByCheck.missing_approval++; breachCount++ }
    if (stages.has('finance') && !stages.has('compliance')) { breachesByCheck.skipped_step++; breachCount++ }
  }
  return { cases_audited: active.length, breach_count: breachCount, breaches_by_check: breachesByCheck }
}

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', HR.email)
  await page.fill('#login-password', HR.password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/hr/, { timeout: 30000 })
  await page.waitForTimeout(2000)
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true })

  console.log('\n--- agent_type discriminates the analytics-family agents ---')
  const { data: rows } = await db.from('analytics_insights').select('agent_type,created_at')
  const byType = {}
  for (const r of rows ?? []) (byType[r.agent_type ?? 'NULL'] ??= []).push(r)
  for (const [k, v] of Object.entries(byType)) console.log(`       ${k.padEnd(28)} ${String(v.length).padStart(3)} rows`)
  if (byType.NULL) fail(`${byType.NULL.length} analytics_insights row(s) have no agent_type`)
  else pass(`every row carries an agent_type (${Object.keys(byType).length} distinct)`)

  const audit = await latest(AUDITOR_TYPE)
  if (!audit) { fail(`no ${AUDITOR_TYPE} row in analytics_insights — run the auditor first`); process.exit(1) }
  const stats = await liveAudit()
  console.log(`       stored audit ${audit.id.slice(0, 8)} @ ${audit.created_at} — ${audit.stats?.cases_audited} cases, ${audit.stats?.breach_count} breaches (stale, narrative-only now)`)
  console.log(`       live recompute — ${stats.cases_audited} cases, ${stats.breach_count} breaches`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`) })

  try {
    await login(page)

    console.log('\n--- nav ---')
    const nav = await page.evaluate(() =>
      [...document.querySelectorAll('nav a, aside a, .sidebar a')].map((a) => ({
        text: a.textContent.trim(), href: a.getAttribute('href') })))
    const item = nav.find((n) => /policy audit/i.test(n.text))
    if (!item) fail(`no "Policy audit" nav item (saw: ${nav.map((n) => n.text).join(', ')})`)
    else pass(`nav item present -> ${item.href}`)

    console.log('\n--- HR Policy audit page ---')
    await page.goto(`${BASE}/hr/policy-audit`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUT}/hr_policy_audit.png`, fullPage: true })

    const view = await page.evaluate(() => ({
      body: document.body.innerText,
      kpis: [...document.querySelectorAll('.kpi')].map((k) => k.textContent.replace(/\s+/g, ' ').trim()),
      checkRows: [...document.querySelectorAll('.card')]
        .filter((c) => /breaches by check/i.test(c.querySelector('.card-title')?.textContent || ''))
        .flatMap((c) => [...c.querySelectorAll('.row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim())),
      strip: document.querySelector('.strip-body')?.textContent.trim() ?? null,
      detailRows: [...document.querySelectorAll('.card')]
        .filter((c) => /breach detail/i.test(c.querySelector('.card-title')?.textContent || ''))
        .flatMap((c) => [...c.querySelectorAll('.row')]).length,
    }))

    if (/no audit has been run yet/i.test(view.body)) return fail('page rendered its empty-state placeholder')

    const cases = view.kpis.find((k) => /cases audited/i.test(k))
    const breaches = view.kpis.find((k) => /breaches found/i.test(k))
    if (!cases?.includes(String(stats.cases_audited))) fail(`"Cases audited" shows ${cases}, live recompute says ${stats.cases_audited}`)
    else pass(`cases audited = ${stats.cases_audited}`)
    if (!breaches?.includes(String(stats.breach_count))) fail(`"Breaches found" shows ${breaches}, live recompute says ${stats.breach_count}`)
    else pass(`total breaches = ${stats.breach_count}`)

    const byCheck = stats.breaches_by_check ?? {}
    for (const c of CHECKS) {
      const row = view.checkRows.find((r) => r.includes(CHECK_LABEL[c]))
      if (!row) { fail(`breakdown is missing the "${CHECK_LABEL[c]}" row`); continue }
      const shown = row.match(/(\d+)\s*$/)?.[1]
      if (shown !== String(byCheck[c] ?? 0)) fail(`${CHECK_LABEL[c]}: page shows ${shown}, live recompute says ${byCheck[c] ?? 0}`)
    }
    if (!failures.some((f) => f.includes('breakdown') || CHECKS.some((c) => f.startsWith(CHECK_LABEL[c])))) {
      pass(`breakdown matches the live recompute (${CHECKS.map((c) => `${c}=${byCheck[c] ?? 0}`).join(', ')})`)
    }

    if (view.strip !== audit.narrative) fail(`recommendation narrative does not match the stored audit row`)
    else pass(`recommendation narrative rendered (${audit.narrative.length} chars)`)

    const expectedDetail = stats.breach_count
    if (view.detailRows !== expectedDetail) fail(`breach detail shows ${view.detailRows} rows, live recompute has ${expectedDetail}`)
    else pass(`breach detail lists all ${expectedDetail} breach(es)`)

    console.log('\n--- regression: #14 still drives Reports, other HR pages intact ---')
    const insight = await latest('dashboard_insights')
    await page.goto(`${BASE}/hr/reports`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const reports = await page.evaluate(() => document.body.innerText)
    if (insight && !reports.includes(insight.narrative.slice(0, 60))) fail('Reports no longer shows the #14 dashboard_insights narrative')
    else pass('Reports still shows #14\'s row')
    if (audit.narrative && reports.includes(audit.narrative.slice(0, 60))) fail('the auditor\'s narrative leaked onto the Reports page')
    else pass('auditor row does not leak into Reports')

    for (const path of ['/hr', '/hr/all-exits', '/hr/escalations', '/hr/risk-and-compliance', '/hr/exit-interviews', '/hr/trends', '/hr/clearances']) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(900)
      const txt = await page.evaluate(() => document.body.innerText.trim())
      if (!txt) fail(`${path} rendered empty`)
    }
    if (!failures.some((f) => f.includes('rendered empty'))) pass('all 7 existing HR pages still render')
  } catch (e) {
    fail(`threw: ${e.message}`)
  } finally {
    if (errors.length) fail(`console errors: ${errors.slice(0, 2).join(' | ').slice(0, 240)}`)
    await browser.close()
  }

  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

run().catch((e) => { console.error(e); process.exit(1) })
