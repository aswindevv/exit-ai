// Scoped browser verification for the two Manager dashboard fixes:
//
//   FIX 1  KT approvals is scoped to manager/KT-stage rows only -- no IT,
//          finance or compliance rows -- while escalation rows and the
//          Review/Reject actions are untouched.
//   FIX 2  "Clearances to sign" is ONE sign-off per employee, active only
//          when all that employee's KT tasks are approved, and signing
//          advances the case to the IT stage.
//
// Real data is only READ. Everything that is clicked to mutate state runs
// against two disposable cases (Emp021 / Emp023, neither of which has a case)
// that are purged at the end, restoring both to "no exit case".
//
// Needs the dev server (5173 -- agents/service.py pins ALLOWED_ORIGIN there)
// and the agent service (8787) up:
//   node scripts/verify/verify_manager_kt_clearances.cjs [baseUrl]
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

process.loadEnvFile()

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = 'scripts/clearance_screens'
const MANAGER = { email: 'aravidhan@company.com', password: 'aravidhan@', url: /\/manager/ }

// SIGNER  all KT approved, no IT rows -> the only state where "Sign clearance"
//         is offered. Its KT rows are seeded already-done with the service key
//         rather than clicked through Review, because Review's own
//         /manager-approve call would advance the case first and there would
//         be nothing left for the Sign button to prove.
// GATED   one KT row pending -> must render "Not ready" with no Sign button,
//         and is where Review/Reject are exercised.
const SIGNER = { empId: 'Emp021', ktDone: ['Document support runbooks', 'Hand off on-call rotation'] }
const GATED = { empId: 'Emp023', ktPending: ['Transfer vendor contacts', 'Document open operations issues'] }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const failures = []
const log = (m) => console.log(m)
const fail = (m) => { failures.push(m); console.log('  FAIL ' + m) }
const pass = (m) => console.log('  ok   ' + m)

const CHILD_TABLES = ['exit_tasks', 'agent_runs', 'kt_reviews', 'exit_interviews', 'case_documents']

async function purge(empId) {
  const { data: cases } = await db.from('exit_cases').select('id').eq('employee_id', empId)
  for (const c of cases ?? []) {
    for (const t of CHILD_TABLES) await db.from(t).delete().eq('case_id', c.id)
    await db.from('exit_cases').delete().eq('id', c.id)
  }
  return (cases ?? []).length
}

async function seedCase(empId, ktTitles, status) {
  const { data: p } = await db.from('profiles').select('*').eq('employee_id', empId).single()
  const { data: mgr } = await db.from('profiles').select('id').eq('email', MANAGER.email).single()
  const { data: kase } = await db.from('exit_cases').insert({
    employee_id: empId,
    employee_name: p.full_name,
    email: p.email,
    department: p.department ?? 'Operations',
    role_title: 'Support Engineer',
    manager_id: mgr.id,
    last_working_day: '2026-12-18',
    status: 'in_progress',
  }).select().single()
  await db.from('exit_tasks').insert(
    ktTitles.map((t) => ({ case_id: kase.id, stage: 'manager', title: t, status, due_date: '2026-12-17' })),
  )
  return kase
}

const tasksFor = async (caseId) =>
  (await db.from('exit_tasks').select('id,stage,status,title,escalation_state').eq('case_id', caseId)).data ?? []

async function poll(label, fn, timeoutMs = 120000, everyMs = 2000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > until) { fail(`${label}: timed out after ${timeoutMs / 1000}s`); return null }
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', MANAGER.email)
  await page.fill('#login-password', MANAGER.password)
  await page.click('button.login-submit')
  await page.waitForURL(MANAGER.url, { timeout: 30000 })
  await page.waitForTimeout(2000)
}

const goto = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
}

// ------------------------------------------------- FIX 1: KT approvals scope
async function checkKtScope(page, managerTasks) {
  console.log('\n--- FIX 1: KT approvals scoping ---')
  await goto(page, '/manager/kt-approvals')
  await page.screenshot({ path: `${OUT}/kt_approvals_scoped.png`, fullPage: true })

  const view = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) =>
      /^kt approvals$/i.test(c.querySelector('.card-title')?.textContent?.trim() || ''))
    if (!card) return null
    const rows = [...card.querySelectorAll('.row')].filter((r) => !r.hasAttribute('data-group-header'))
    return {
      rows: rows.map((r) => ({
        text: r.textContent.trim().replace(/\s+/g, ' '),
        tags: [...r.querySelectorAll('.tag')].map((t) => t.textContent.trim()),
        buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
      })),
    }
  })
  if (!view) return fail('KT approvals card not found')

  const managerTitles = new Set(managerTasks.filter((t) => t.stage === 'manager').map((t) => t.title))
  const offStage = managerTasks.filter((t) => t.stage !== 'manager')
  // A title can legitimately be reused across stages; only flag a rendered row
  // whose title exists ONLY at a non-manager stage.
  const leaked = offStage.filter((t) => !managerTitles.has(t.title) && view.rows.some((r) => r.text.includes(t.title)))
  if (leaked.length) {
    fail(`${leaked.length} non-manager-stage row(s) rendered in KT approvals -> ` +
      leaked.slice(0, 3).map((t) => `[${t.stage}] ${t.title}`).join(' | '))
  } else {
    pass(`no IT/finance/compliance rows in KT approvals (${offStage.length} such task(s) exist on these cases)`)
  }

  const unknown = view.rows.filter((r) => ![...managerTitles].some((t) => r.text.includes(t)))
  if (unknown.length) fail(`${unknown.length} KT row(s) match no manager-stage task -> ${unknown[0].text.slice(0, 90)}`)
  else pass(`all ${view.rows.length} rendered rows are stage='manager' tasks`)

  const escalationRows = view.rows.filter((r) => r.tags.includes('Escalated to HR'))
  if (!escalationRows.length) fail('no "Escalated to HR" rows rendered — escalation display regressed')
  else pass(`escalation rows intact (${escalationRows.length} rendered)`)

  const reviewable = view.rows.filter((r) => r.buttons.includes('Review') && r.buttons.includes('Reject'))
  if (!reviewable.length) fail('no row offers both Review and Reject')
  else pass(`Review + Reject still offered on ${reviewable.length} row(s)`)
}

// ------------------------------- FIX 2: one sign-off per employee, no per-task
async function checkClearanceShape(page, reports, allTasks) {
  console.log('\n--- FIX 2: Clearances to sign — one row per employee ---')
  await goto(page, '/manager/clearances')
  await page.screenshot({ path: `${OUT}/clearances_per_employee.png`, fullPage: true })

  const view = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) =>
      /^clearances to sign$/i.test(c.querySelector('.card-title')?.textContent?.trim() || ''))
    if (!card) return null
    return {
      cases: [...card.querySelectorAll('[data-clearance-case]')].map((d) => ({
        caseId: d.getAttribute('data-clearance-case'),
        text: d.textContent.trim().replace(/\s+/g, ' '),
        enabledSign: [...d.querySelectorAll('button')].some(
          (b) => /sign clearance/i.test(b.textContent) && !b.disabled),
        buttons: [...d.querySelectorAll('button')].length,
      })),
      totalButtons: [...card.querySelectorAll('button')].length,
    }
  })
  if (!view) return fail('Clearances card not found')

  const ids = view.cases.map((c) => c.caseId)
  if (new Set(ids).size !== ids.length) fail('an employee appears in the clearance list more than once')
  else pass(`one row per employee (${ids.length} rows, ${new Set(ids).size} distinct cases)`)

  const missing = reports.filter((r) => !ids.includes(r.id))
  if (missing.length) fail(`${missing.length} of the manager's report(s) missing from the clearance list`)
  else pass(`all ${reports.length} exiting reports listed`)

  // No per-task duplication: an individual KT task title must not be rendered.
  const ktTitles = [...new Set(allTasks.filter((t) => t.stage === 'manager' &&
    !t.title.startsWith('Escalated')).map((t) => t.title))]
  const dupes = ktTitles.filter((t) => view.cases.some((c) => c.text.includes(t)))
  if (dupes.length) fail(`${dupes.length} individual KT task title(s) still listed -> ${dupes[0]}`)
  else pass(`no individual KT task rows (checked ${ktTitles.length} KT titles)`)

  const offStage = [...new Set(allTasks.filter((t) => t.stage !== 'manager').map((t) => t.title))]
  const leaked = offStage.filter((t) => view.cases.some((c) => c.text.includes(t)))
  if (leaked.length) fail(`${leaked.length} IT/finance/compliance title(s) listed -> ${leaked[0]}`)
  else pass(`no IT/finance/compliance rows (checked ${offStage.length} titles)`)

  if (view.totalButtons > view.cases.length) {
    fail(`${view.totalButtons} buttons for ${view.cases.length} employees — more than one action per employee`)
  } else pass(`at most one action per employee (${view.totalButtons} buttons / ${view.cases.length} rows)`)

  // A Sign button may only be active when every KT task for that case is done
  // and the case has not already advanced.
  for (const c of view.cases) {
    const kt = allTasks.filter((t) => t.case_id === c.caseId && t.stage === 'manager' &&
      !t.title.startsWith('Escalated'))
    const escalated = allTasks.some((t) => t.case_id === c.caseId && t.escalation_state === 'open')
    const advanced = allTasks.some((t) => t.case_id === c.caseId && t.stage === 'it')
    const shouldSign = kt.length > 0 && kt.every((t) => t.status === 'done') && !escalated && !advanced
    if (c.enabledSign !== shouldSign) {
      fail(`case ${c.caseId.slice(0, 8)}: Sign enabled=${c.enabledSign} but KT ${kt.filter((t) => t.status === 'done').length}/${kt.length} done, escalated=${escalated}, advanced=${advanced}`)
    }
  }
  if (!failures.length || !failures.some((f) => f.includes('Sign enabled'))) {
    pass('every Sign button matches the database (all KT approved, not escalated, not yet advanced)')
  }
  return view
}

// --------------------------------- FIX 1 regression: Review / Reject still act
async function checkReviewReject(page, kase) {
  console.log('\n--- FIX 1 regression: Review / Reject on a disposable case ---')
  await goto(page, '/manager/kt-approvals')

  const clicked = await page.evaluate(({ name, label }) => {
    const h = [...document.querySelectorAll('[data-group-header="true"]')].find((x) => x.textContent.includes(name))
    if (!h) return { group: false }
    let node = h.nextElementSibling
    while (node && !node.hasAttribute('data-group-header')) {
      const btn = [...node.querySelectorAll('button')].find((b) => b.textContent.trim().replace(/…$/, '') === label && !b.disabled)
      if (btn) { btn.click(); return { group: true, clicked: true, row: node.textContent.trim().slice(0, 70) } }
      node = node.nextElementSibling
    }
    return { group: true, clicked: false }
  }, { name: kase.employee_name, label: 'Review' })

  if (!clicked.group) return fail('disposable case has no group on KT approvals')
  if (!clicked.clicked) return fail('no Review button offered for the disposable case')
  const approved = await poll('Review marked a KT task done', async () => {
    const t = await tasksFor(kase.id)
    return t.some((x) => x.stage === 'manager' && x.status === 'done') ? t : null
  }, 45000)
  if (approved) pass(`Review still approves (${clicked.row})`)

  await goto(page, '/manager/kt-approvals')
  page.once('dialog', (d) => d.accept('Scoped verification run — handover incomplete.'))
  const rejected = await page.evaluate(({ name }) => {
    const h = [...document.querySelectorAll('[data-group-header="true"]')].find((x) => x.textContent.includes(name))
    if (!h) return { group: false }
    let node = h.nextElementSibling
    while (node && !node.hasAttribute('data-group-header')) {
      const btn = [...node.querySelectorAll('button')].find((b) => b.textContent.trim().replace(/…$/, '') === 'Reject' && !b.disabled)
      if (btn) { btn.click(); return { group: true, clicked: true } }
      node = node.nextElementSibling
    }
    return { group: true, clicked: false }
  }, { name: kase.employee_name })
  if (!rejected.clicked) return fail('no Reject button offered for the disposable case')
  const esc = await poll('Reject escalated the case', async () => {
    const t = await tasksFor(kase.id)
    const e = t.filter((x) => (x.title ?? '').startsWith('Escalated'))
    return e.length ? e : null
  }, 60000)
  if (esc) pass(`Reject still escalates ("${esc[0].title}" / ${esc[0].escalation_state})`)

  // And the escalated case must now read as not-signable.
  await goto(page, '/manager/clearances')
  const state = await page.evaluate((id) => {
    const d = document.querySelector(`[data-clearance-case="${id}"]`)
    return d ? { text: d.textContent.replace(/\s+/g, ' ').trim(), enabledSign: [...d.querySelectorAll('button')].some((b) => !b.disabled) } : null
  }, kase.id)
  if (!state) fail('escalated case missing from the clearance list')
  else if (state.enabledSign) fail(`escalated case still offers an active Sign action -> ${state.text}`)
  else pass(`escalated case is not signable -> ${state.text.slice(0, 90)}`)
}

// ------------------------------- FIX 2: signing advances the case to IT stage
async function checkSignAdvances(page, kase) {
  console.log('\n--- FIX 2: signing a clearance advances the case to IT ---')
  const before = await tasksFor(kase.id)
  if (before.some((t) => t.stage === 'it')) return fail('precondition broken: disposable case already has IT tasks')
  pass('precondition: all KT approved, zero stage=it tasks')

  await goto(page, '/manager/clearances')
  const clicked = await page.evaluate((id) => {
    const d = document.querySelector(`[data-clearance-case="${id}"]`)
    if (!d) return { found: false }
    const btn = [...d.querySelectorAll('button')].find((b) => /sign clearance/i.test(b.textContent) && !b.disabled)
    if (!btn) return { found: true, clicked: false, text: d.textContent.replace(/\s+/g, ' ').trim() }
    btn.click()
    return { found: true, clicked: true }
  }, kase.id)
  if (!clicked.found) return fail('ready-to-sign case missing from the clearance list')
  if (!clicked.clicked) return fail(`no active "Sign clearance" button on a fully-approved case -> ${clicked.text}`)
  pass('"Sign clearance" offered and clicked')

  const withIt = await poll('IT tasks created by the clearance sign-off', async () => {
    const t = await tasksFor(kase.id)
    return t.some((x) => x.stage === 'it') ? t : null
  }, 180000)
  if (withIt) pass(`case advanced to IT (${withIt.filter((t) => t.stage === 'it').length} stage=it task(s) created)`)

  const gate = (await db.from('agent_runs').select('detail').eq('case_id', kase.id)
    .eq('stage', 'manager').eq('detail', 'approved')).data ?? []
  if (gate.length !== 1) fail(`expected exactly 1 agent_runs manager/approved row, got ${gate.length}`)
  else pass('manager gate recorded once: "approved"')

  await page.waitForTimeout(2000)
  await goto(page, '/manager/clearances')
  const after = await page.evaluate((id) => {
    const d = document.querySelector(`[data-clearance-case="${id}"]`)
    return d ? { text: d.textContent.replace(/\s+/g, ' ').trim(), enabledSign: [...d.querySelectorAll('button')].some((b) => !b.disabled) } : null
  }, kase.id)
  await page.screenshot({ path: `${OUT}/clearances_after_sign.png`, fullPage: true })
  if (after?.enabledSign) fail('signed case still offers an active Sign action (would re-trigger the gate)')
  else pass(`signed case reads: ${after?.text.slice(0, 90)}`)
}

// ---------------------------------------------- RLS: scope is the manager's own
async function checkScope(page, reports) {
  console.log('\n--- RLS / scope ---')
  const { data: mgr } = await db.from('profiles').select('id').eq('email', MANAGER.email).single()
  const { data: mine } = await db.from('exit_cases').select('id').eq('manager_id', mgr.id)
  const mineIds = new Set((mine ?? []).map((c) => c.id))
  const foreign = reports.filter((r) => !mineIds.has(r.id))
  if (foreign.length) fail(`${foreign.length} case(s) visible that are not this manager's reports`)
  else pass(`manager_case_view returned only own reports (${reports.length})`)
}

// -------------------------------------------------------------------- driver
async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  for (const e of [SIGNER, GATED]) {
    const n = await purge(e.empId)
    if (n) log(`pre-clean: removed ${n} leftover case(s) for ${e.empId}`)
  }
  const signerCase = await seedCase(SIGNER.empId, SIGNER.ktDone, 'done')
  const gatedCase = await seedCase(GATED.empId, GATED.ktPending, 'pending')
  log(`seeded disposable cases: ${signerCase.employee_name} (all KT approved), ${gatedCase.employee_name} (KT pending)`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`) })

  try {
    await login(page)
    const { data: mgr } = await db.from('profiles').select('id').eq('email', MANAGER.email).single()
    const { data: cases } = await db.from('exit_cases').select('id,employee_name,created_at').eq('manager_id', mgr.id)
    const allTasks = (await db.from('exit_tasks').select('id,case_id,stage,status,title,escalation_state')
      .in('case_id', cases.map((c) => c.id))).data ?? []

    await checkScope(page, cases)
    await checkKtScope(page, allTasks)
    await checkClearanceShape(page, cases, allTasks)
    await checkReviewReject(page, gatedCase)
    await checkSignAdvances(page, signerCase)
  } catch (e) {
    fail(`threw: ${e.message}`)
  } finally {
    if (errors.length) fail(`console errors: ${errors.slice(0, 2).join(' | ').slice(0, 240)}`)
    await browser.close()
    console.log('\n--- cleanup ---')
    for (const e of [SIGNER, GATED]) {
      await purge(e.empId)
      const { data: left } = await db.from('exit_cases').select('id').eq('employee_id', e.empId)
      if (left?.length) fail(`cleanup: ${e.empId} still has a case`)
      else log(`  ${e.empId} restored to no-exit-case`)
    }
  }

  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

run().catch((e) => { console.error(e); process.exit(1) })
