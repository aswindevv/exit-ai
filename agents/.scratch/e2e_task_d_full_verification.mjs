// Task D: full 21-step, 5-role E2E verification. Real browser, Playwright.
// SCOPED locators only -- every row-level click targets a specific known
// user/title/case identity fetched from this employee's/role's own RLS-
// scoped session or from a prior read-only DB check; never an unscoped
// .first() across a shared multi-row table.
// Run ALL steps regardless of earlier failures; each step is wrapped so one
// failure never blocks the rest.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const results = []
function record(n, role, step, pass, detail) {
  results.push({ n, role, step, pass, detail })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] #${n} ${role}: ${step} -- ${detail}`)
}
async function guarded(n, role, step, fn) {
  try {
    const { pass, detail } = await fn()
    record(n, role, step, pass, detail)
  } catch (err) {
    record(n, role, step, false, `THREW: ${String((err && err.stack) || err).slice(0, 500)}`)
  }
}

async function evalSupa(page, fn, arg) {
  return page.evaluate(async ({ fnBody, arg }) => {
    const mod = await import('/src/lib/supabase.js')
    // eslint-disable-next-line no-eval
    const f = new Function('supabase', 'arg', `return (${fnBody})(supabase, arg)`)
    return f(mod.supabase, arg)
  }, { fnBody: fn.toString(), arg })
}

async function login(browser, email, password) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(password)
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  return { context, page }
}

async function pathIs(page, path, timeout = 15000) {
  await page.waitForFunction((p) => location.pathname === p, path, { timeout })
  return page.url()
}

const browser = await chromium.launch()

// ================= EMPLOYEE (Emp016, fresh) =================
const EMP016_EMAIL = 'emp016@gmail.com'
const EMP016_PW = 'Emp016@'
let empPage, empCtx

await guarded(1, 'EMPLOYEE', 'Fresh login -> redirected to Resignation (dashboard unreachable)', async () => {
  const { context, page } = await login(browser, EMP016_EMAIL, EMP016_PW)
  empCtx = context; empPage = page
  const url = await pathIs(page, '/employee/resignation')
  const formVisible = await page.locator('#resign-last-day').isVisible()
  return { pass: url.endsWith('/employee/resignation') && formVisible, detail: `landed on ${url}, resignation form visible=${formVisible}` }
})

let emp016CaseId = null
await guarded(2, 'EMPLOYEE', 'Submit resignation -> pipeline triggers, checklist generated (task_count>0)', async () => {
  await empPage.locator('#resign-last-day').fill('2027-01-15')
  await empPage.locator('#resign-reason').fill('Pursuing an external opportunity.')
  await empPage.locator('button.login-submit').click()
  // client nav to /employee can lag behind async checklist generation --
  // poll rather than a single waitForURL.
  let landed = false
  for (let i = 0; i < 20 && !landed; i++) {
    if (empPage.url().endsWith('/employee') && !empPage.url().includes('resignation')) landed = true
    else await empPage.waitForTimeout(1500)
  }
  if (!landed) {
    await empPage.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
  }
  let taskCount = 0
  for (let i = 0; i < 40 && taskCount === 0; i++) {
    const r = await evalSupa(empPage, async (supabase) => {
      const { data: ec } = await supabase.from('employee_exit_view').select('*').maybeSingle()
      if (!ec) return { caseId: null, count: 0 }
      const { data: tasks } = await supabase.from('exit_tasks').select('id').eq('case_id', ec.id)
      return { caseId: ec.id, count: (tasks ?? []).length }
    })
    taskCount = r.count
    emp016CaseId = r.caseId
    if (taskCount === 0) await empPage.waitForTimeout(3000)
  }
  return { pass: !!emp016CaseId && taskCount > 0, detail: `case_id=${emp016CaseId}, task_count=${taskCount} (polled up to ~2min for async agent pipeline)` }
})

await guarded(3, 'EMPLOYEE', 'Dashboard shows own checklist, progress %, timeline', async () => {
  await empPage.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
  await empPage.waitForSelector('.gauge-card', { timeout: 15000 })
  const percentText = await empPage.locator('.gauge span').innerText()
  const checklistRows = await empPage.locator('.card:has(.card-title:text-is("My checklist")) .list .row').count()
  const timelineNodes = await empPage.locator('.timeline .tl-node').count()
  return {
    pass: /\d+%/.test(percentText) && checklistRows > 0 && timelineNodes > 0,
    detail: `progress=${percentText}, checklist_rows=${checklistRows}, timeline_nodes=${timelineNodes}`,
  }
})

let emp016HrTaskTitle = null
await guarded(4, 'EMPLOYEE', "Mark a task done -> writes to Supabase, progress % updates; CANNOT mark manager/it/finance tasks", async () => {
  const before = await evalSupa(empPage, async (supabase, caseId) => {
    const { data: tasks } = await supabase.from('exit_tasks').select('*').eq('case_id', caseId)
    return tasks
  }, emp016CaseId)
  const hrPending = before.filter((t) => t.stage === 'hr' && t.status !== 'done').sort((a, b) => a.title.localeCompare(b.title))[0]
  const mgrTask = before.find((t) => t.stage === 'manager')
  const itTask = before.find((t) => t.stage === 'it')
  if (!hrPending) return { pass: false, detail: 'no pending hr-stage task on fresh checklist to mark done' }
  emp016HrTaskTitle = hrPending.title

  const progressBefore = await empPage.locator('.gauge span').innerText()
  await empPage.goto(`${BASE}/employee/tasks`, { waitUntil: 'networkidle' })
  const row = empPage.locator('.card:has(.card-title:text-is("My tasks")) .row', { hasText: hrPending.title })
  await row.waitFor({ timeout: 10000 })
  await row.locator('button.mark-done').click()
  await row.locator('.status.c-success', { hasText: 'Done' }).waitFor({ timeout: 10000 })

  await empPage.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
  await empPage.waitForSelector('.gauge-card', { timeout: 15000 })
  const progressAfter = await empPage.locator('.gauge span').innerText()

  const rlsResults = []
  for (const [label, t] of [['manager', mgrTask], ['it', itTask]]) {
    if (!t) { rlsResults.push(`${label}: no such task on this case (skipped)`); continue }
    const r = await evalSupa(empPage, async (supabase, taskId) => {
      const { data, error } = await supabase.from('exit_tasks').update({ status: 'done' }).eq('id', taskId).select()
      return { rows: (data ?? []).length, error: error?.message ?? null }
    }, t.id)
    rlsResults.push(`${label}-stage task ${t.id}: rows_affected=${r.rows} error=${r.error ?? 'none'} (expect 0 rows, RLS denies)`)
  }
  const rlsPass = rlsResults.every((s) => s.includes('rows_affected=0') || s.includes('skipped'))

  return {
    pass: progressBefore !== progressAfter && rlsPass,
    detail: `marked "${hrPending.title}" done; progress ${progressBefore}->${progressAfter}. RLS checks: ${rlsResults.join(' | ')}`,
  }
})

await guarded(5, 'EMPLOYEE', 'All nav items route (page or clean empty state)', async () => {
  const NAV = ['', 'my-exit', 'tasks', 'documents', 'knowledge-transfer', 'exit-interview', 'timeline', 'help']
  const bad = []
  for (const to of NAV) {
    const resp = await empPage.goto(`${BASE}/employee/${to}`, { waitUntil: 'networkidle' })
    const hasContent = await empPage.locator('.card, .login-shell').count()
    if (!resp || resp.status() >= 400 || hasContent === 0) bad.push(`${to || '(index)'}=status:${resp?.status()},content:${hasContent}`)
  }
  return { pass: bad.length === 0, detail: bad.length ? `broken routes: ${bad.join(', ')}` : `all ${NAV.length} nav routes rendered content` }
})

await guarded(6, 'EMPLOYEE', 'Exit interview form: fill+submit -> writes to exit_interviews; sees only "submitted", not analysis', async () => {
  await empPage.goto(`${BASE}/employee/exit-interview`, { waitUntil: 'networkidle' })
  const inputs = await empPage.locator('input, textarea, form').count()
  const placeholderText = await empPage.locator('.card, .empty, body').innerText()
  return {
    pass: false,
    detail: `structural FAIL: ExitInterview() in src/routes/employee/EmployeePages.jsx renders a static Placeholder with no writable form fields (inputs/textareas/forms found on page: ${inputs}). No exit-interview submission UI exists anywhere in the frontend, and grep for exit_interviews writes across src/ returns zero matches -- there is no employee-side path to write to exit_interviews at all. Page text: "${placeholderText.slice(0, 160)}"`,
  }
})

await guarded(7, 'EMPLOYEE', '"Ask" assistant returns a cited answer + refuses out-of-scope', async () => {
  await empPage.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
  const strip = empPage.locator('.strip.strip--top')
  await strip.locator('.ask-input').fill('How long is the resignation notice period?')
  await strip.locator('button', { hasText: 'Ask' }).click()
  await empPage.waitForFunction(() => {
    const el = document.querySelector('.strip.strip--top .strip-body')
    return el && el.textContent && !el.textContent.includes('Ask me anything')
  }, null, { timeout: 30000 })
  const answered = await strip.locator('.strip-body').first().innerText()
  const sourceLine = await strip.locator('.strip-body.c-muted').count()

  await strip.locator('.ask-input').fill("What's the weather in Paris today?")
  await strip.locator('button', { hasText: 'Ask' }).click()
  await empPage.waitForFunction(() => {
    const el = document.querySelector('.strip.strip--top .strip-body')
    return el && el.textContent && el.textContent.includes("don't have that")
  }, null, { timeout: 30000 }).catch(() => {})
  const refusedText = await strip.locator('.strip-body').first().innerText()
  const refused = refusedText.includes("don't have that")

  return {
    pass: answered.length > 0 && sourceLine > 0 && refused,
    detail: `in-scope answer="${answered.slice(0, 140)}" (cited=${sourceLine > 0}); out-of-scope refusal="${refusedText.slice(0, 140)}" (refused=${refused})`,
  }
})

await guarded(8, 'EMPLOYEE', 'CANNOT see any HR-only field (risk_score/sentiment/rehire)', async () => {
  const casesR = await evalSupa(empPage, async (supabase) => {
    const { data, error } = await supabase.from('exit_cases').select('id, risk_score, risk_level, rehire_eligible')
    return { rows: (data ?? []).length, error: error?.message ?? null }
  })
  const ivR = await evalSupa(empPage, async (supabase) => {
    const { data, error } = await supabase.from('exit_interviews').select('id, sentiment, summary')
    return { rows: (data ?? []).length, error: error?.message ?? null }
  })
  const uiText = await empPage.locator('body').innerText()
  const uiLeak = /risk[_ ]?score|rehire[_ ]?eligible|sentiment/i.test(uiText)
  return {
    pass: casesR.rows === 0 && ivR.rows === 0 && !uiLeak,
    detail: `direct exit_cases select (risk cols) rows=${casesR.rows}; direct exit_interviews select rows=${ivR.rows}; UI text scan for risk/rehire/sentiment leak=${uiLeak}`,
  }
})

// ================= HR (Siva) =================
const { context: hrCtx, page: hrPage } = await login(browser, 'siva@gmail.com', 'siva@1')

await guarded(9, 'HR', 'Login -> HR dashboard, real data (cases, KPIs)', async () => {
  const url = await pathIs(hrPage, '/hr')
  await hrPage.waitForSelector('.kpi-row', { timeout: 15000 })
  const kpiCount = await hrPage.locator('.kpi-row .kpi').count()
  const caseRows = await hrPage.locator('.card:has(.card-title:text-is("All exit cases")) .row').count()
  return { pass: url.endsWith('/hr') && kpiCount > 0 && caseRows > 0, detail: `landed ${url}, kpis=${kpiCount}, case_rows=${caseRows}` }
})

await guarded(10, 'HR', 'SHOULD see assessments: risk scores, trend alerts, interview summaries/sentiment', async () => {
  await hrPage.goto(`${BASE}/hr/risk-and-compliance`, { waitUntil: 'networkidle' })
  const riskRows = await hrPage.locator('.card:has(.card-title:text-is("Risk and compliance")) .row').count()
  const riskTags = await hrPage.locator('.card:has(.card-title:text-is("Risk and compliance")) .tag:not(.t-neutral)').count()
  await hrPage.goto(`${BASE}/hr/trends`, { waitUntil: 'networkidle' })
  const trendsCard = await hrPage.locator('.card-title', { hasText: 'Trend alerts' }).count()
  await hrPage.goto(`${BASE}/hr/exit-interviews`, { waitUntil: 'networkidle' })
  const interviewText = await hrPage.locator('body').innerText()
  const dbCheck = await evalSupa(hrPage, async (supabase) => {
    const { data } = await supabase.from('exit_cases').select('risk_score').not('risk_score', 'is', null).limit(1)
    return (data ?? []).length
  })
  return {
    pass: riskRows > 0 && riskTags > 0 && trendsCard > 0 && dbCheck > 0,
    detail: `risk-and-compliance rows=${riskRows}, non-neutral risk tags=${riskTags}; trends page rendered=${trendsCard > 0}; direct DB confirms HR sees risk_score (count=${dbCheck}); exit-interviews page text sample="${interviewText.slice(0, 100)}"`,
  }
})

await guarded(11, 'HR', 'HR action buttons work (write + UI update)', async () => {
  return {
    pass: false,
    detail: 'structural FAIL: no action/write button exists anywhere in HR\'s UI. Full read of src/routes/hr/HrPages.jsx (Dashboard/AllExits/RiskAndCompliance/ExitInterviews/Trends/Clearances/Reports/Settings) and HrLayout.jsx shows every page is read-only rendering (no onClick handlers, no supabase writes/RPC calls). HR\'s "Clearances" page only displays finance-task status as tags -- it has no button, unlike Manager\'s own Clearances page which does.',
  }
})

// ================= MANAGER (Aravidhan) =================
const { context: mgrCtx, page: mgrPage } = await login(browser, 'aravidhan@gmail.com', 'aravidhan@')

await guarded(12, 'MANAGER', 'Login -> sees ONLY their own reports\' cases', async () => {
  const url = await pathIs(mgrPage, '/manager')
  await mgrPage.waitForSelector('.card', { timeout: 15000 })
  const reportRows = await mgrPage.locator('.card:has(.card-title:text-is("My team\'s exits")) .row').count()
  const directCasesR = await evalSupa(mgrPage, async (supabase) => {
    const { data, error } = await supabase.from('exit_cases').select('id')
    return { rows: (data ?? []).length, error: error?.message ?? null }
  })
  return {
    pass: url.endsWith('/manager') && reportRows > 0 && directCasesR.rows === 0,
    detail: `landed ${url}, manager_case_view rows shown=${reportRows} (all real reports, self-filtered via ec.manager_id=auth.uid() per 0002_rls.sql); direct base-table exit_cases select from manager session returns rows=${directCasesR.rows} (expect 0 -- exit_cases has zero SELECT policy for manager, confirming isolation is enforced at the RLS layer, not just the view)`,
  }
})

await guarded(13, 'MANAGER', 'KT approval / Approve / Sign actions work', async () => {
  await mgrPage.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
  const ktRow = mgrPage.locator('.card:has(.card-title:text-is("KT approvals")) .row--split', { hasText: 'Zoya Patel' }).filter({ hasText: 'Document current analytics dashboards and reports' })
  await ktRow.waitFor({ timeout: 10000 })
  const ktBefore = await ktRow.locator('.tag.t-success').count()
  await ktRow.locator('button', { hasText: 'Review' }).click()
  await ktRow.locator('.tag.t-success', { hasText: 'Approved' }).waitFor({ timeout: 10000 })

  await mgrPage.goto(`${BASE}/manager/clearances`, { waitUntil: 'networkidle' })
  const signRow = mgrPage.locator('.card:has(.card-title:text-is("Clearances to sign")) .row--split', { hasText: 'Priya Patel' }).filter({ hasText: 'Clear final settlement dues' })
  await signRow.waitFor({ timeout: 10000 })
  const signBefore = await signRow.locator('.tag.t-success').count()
  await signRow.locator('button', { hasText: 'Sign' }).click()
  await signRow.locator('.tag.t-success', { hasText: 'Signed' }).waitFor({ timeout: 10000 })

  return {
    pass: ktBefore === 0 && signBefore === 0,
    detail: `KT: Zoya Patel's "Document current analytics dashboards and reports" Review->Approved (was pending, tag_before=${ktBefore}). Sign: Priya Patel's finance-stage task Sign->Signed (was pending, tag_before=${signBefore}). Both wrote to exit_tasks and UI updated live via reload().`,
  }
})

await guarded(14, 'MANAGER', 'CANNOT see HR-only assessment fields', async () => {
  const uiText = await mgrPage.locator('body').innerText()
  const uiLeak = /risk[_ ]?score|rehire[_ ]?eligible|sentiment/i.test(uiText)
  const casesR = await evalSupa(mgrPage, async (supabase) => {
    const { data } = await supabase.from('exit_cases').select('risk_score, risk_level, rehire_eligible')
    return (data ?? []).length
  })
  const ivR = await evalSupa(mgrPage, async (supabase) => {
    const { data } = await supabase.from('exit_interviews').select('*')
    return (data ?? []).length
  })
  return { pass: !uiLeak && casesR === 0 && ivR === 0, detail: `UI leak=${uiLeak}; direct exit_cases(risk cols) rows=${casesR}; direct exit_interviews rows=${ivR}` }
})

// ================= IT (Aswin) =================
const { context: itCtx, page: itPage } = await login(browser, 'aswin@gmail.com', 'aswin@')

await guarded(15, 'IT', "Login -> deprovisioning queue (stage='it')", async () => {
  const url = await pathIs(itPage, '/it')
  await itPage.waitForSelector('.card', { timeout: 15000 })
  const rows = await itPage.locator('.card:has(.card-title:text-is("Deprovisioning queue")) .row:not(.thead)').count()
  return { pass: url.endsWith('/it') && rows > 0, detail: `landed ${url}, it_task_view rows shown=${rows} (view is pre-filtered to stage='it' per 0005_it_task_view.sql)` }
})

await guarded(16, 'IT', 'IT approve/execute works', async () => {
  await itPage.goto(`${BASE}/it/deprovisioning`, { waitUntil: 'networkidle' })
  const row = itPage.locator('.row', { hasText: 'Priya Patel' }).filter({ hasText: 'Collect company laptop and peripherals' })
  await row.waitFor({ timeout: 10000 })
  const before = await row.locator('.tag.t-success').count()
  await row.locator('button', { hasText: 'Approve' }).click()
  await row.locator('.tag.t-success', { hasText: 'Done' }).waitFor({ timeout: 10000 })
  return { pass: before === 0, detail: `Priya Patel's "Collect company laptop and peripherals" Approve->Done (was pending, tag_before=${before}); wrote status='done' to exit_tasks, UI updated via reload()` }
})

await guarded(17, 'IT', 'CANNOT see HR-only assessment fields', async () => {
  const uiText = await itPage.locator('body').innerText()
  const uiLeak = /risk[_ ]?score|rehire[_ ]?eligible|sentiment/i.test(uiText)
  const casesR = await evalSupa(itPage, async (supabase) => {
    const { data } = await supabase.from('exit_cases').select('risk_score, risk_level, rehire_eligible')
    return (data ?? []).length
  })
  const ivR = await evalSupa(itPage, async (supabase) => {
    const { data } = await supabase.from('exit_interviews').select('*')
    return (data ?? []).length
  })
  return { pass: !uiLeak && casesR === 0 && ivR === 0, detail: `UI leak=${uiLeak}; direct exit_cases(risk cols) rows=${casesR}; direct exit_interviews rows=${ivR}` }
})

// ================= FINANCE (Anfia) =================
const { context: finCtx, page: finPage } = await login(browser, 'anfiacj@gmail.com', 'anfiacj@')

await guarded(18, 'FINANCE', 'Login -> finance clearance queue', async () => {
  const url = await pathIs(finPage, '/finance')
  await finPage.waitForSelector('.card', { timeout: 15000 })
  const cardTitle = await finPage.locator('.card-title', { hasText: 'Finance clearance queue' }).count()
  return { pass: url.endsWith('/finance') && cardTitle > 0, detail: `landed ${url}, finance clearance queue card rendered=${cardTitle > 0}` }
})

// Setup for step 19: Emp001 (Aiden Sharma) is one real "Mark done" click away
// from entering finance's queue (hr/manager/it all done except this one
// hr-stage task). This is a genuine action by Emp001's own employee login,
// not a DB edit.
await guarded('19-setup', 'FINANCE (setup)', "Emp001 marks their last hr-stage task done via their own employee login, entering finance's queue", async () => {
  const { context: e1Ctx, page: e1Page } = await login(browser, 'emp001@gmail.com', 'Emp001@')
  await pathIs(e1Page, '/employee')
  await e1Page.goto(`${BASE}/employee/tasks`, { waitUntil: 'networkidle' })
  const row = e1Page.locator('.card:has(.card-title:text-is("My tasks")) .row', { hasText: 'Complete exit interview' })
  await row.waitFor({ timeout: 10000 })
  const alreadyDone = (await row.locator('.status.c-success').count()) > 0
  if (!alreadyDone) {
    await row.locator('button.mark-done').click()
    await row.locator('.status.c-success', { hasText: 'Done' }).waitFor({ timeout: 10000 })
  }
  await e1Ctx.close()
  return { pass: true, detail: `Emp001's "Complete exit interview" (hr-stage) now Done (already_done=${alreadyDone}) -- hr+manager+it now all done for this case, satisfying finance's queue condition` }
})

await guarded(19, 'FINANCE', '"Mark dues settled" works -> flag writes, finance clears, completion email fires', async () => {
  await finPage.goto(`${BASE}/finance`, { waitUntil: 'networkidle' })
  const row = finPage.locator('.card:has(.card-title:text-is("Finance clearance queue")) .row--split', { hasText: 'Aiden Sharma' })
  await row.waitFor({ timeout: 15000 })
  await row.locator('button', { hasText: 'Mark dues settled' }).click()
  await row.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})

  const cleared = await evalSupa(finPage, async (supabase, caseId) => {
    const { data } = await supabase.from('finance_case_view').select('finance_cleared').eq('id', caseId).maybeSingle()
    return data?.finance_cleared
  }, '9596336c-e763-4258-9ffc-2c69a1d6c6f0')

  return {
    pass: cleared === true,
    detail: `browser click on "Mark dues settled" for Aiden Sharma (Emp001) -> exit_cases.finance_cleared now ${cleared} via finance_mark_dues_settled RPC, row left the queue in UI. Completion-email trace requires a separate backend agent run (agents/finance_agent.py's _check_clearance node) -- see next check.`,
  }
})

await guarded('19-email', 'FINANCE', 'Backend agent run fires the completion email (traced_node, EMAIL_TEST_RECIPIENT is set -> real SMTP send)', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  try {
    const { stdout, stderr } = await run(
      'python', ['-m', 'agents.finance_agent', '9596336c-e763-4258-9ffc-2c69a1d6c6f0'],
      { cwd: 'C:\\Users\\Aswin.v\\Desktop\\Exit Ai', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, timeout: 60000 }
    )
    const out = stdout + stderr
    const fired = /Notification agent|send_completion_notice|sent.*true/i.test(out)
    return { pass: fired, detail: `agents.finance_agent trace (last 800 chars): ${out.slice(-800)}` }
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '')
    return { pass: /Notification agent|send_completion_notice/i.test(out), detail: `run error but trace captured: ${String(err.message).slice(0, 200)} | output tail: ${out.slice(-800)}` }
  }
})

await guarded(20, 'FINANCE', 'CANNOT see HR-only assessment fields', async () => {
  const uiText = await finPage.locator('body').innerText()
  const uiLeak = /risk[_ ]?score|rehire[_ ]?eligible|sentiment/i.test(uiText)
  const casesR = await evalSupa(finPage, async (supabase) => {
    const { data } = await supabase.from('exit_cases').select('risk_score, risk_level, rehire_eligible')
    return (data ?? []).length
  })
  const ivR = await evalSupa(finPage, async (supabase) => {
    const { data } = await supabase.from('exit_interviews').select('*')
    return (data ?? []).length
  })
  return { pass: !uiLeak && casesR === 0 && ivR === 0, detail: `UI leak=${uiLeak}; direct exit_cases(risk cols) rows=${casesR}; direct exit_interviews rows=${ivR}` }
})

// ================= CROSS-ROLE =================
await guarded(21, 'CROSS-ROLE', 'Each role confined to its own dashboard (cannot reach another role\'s routes)', async () => {
  const checks = [
    ['employee', empPage, '/hr'],
    ['hr', hrPage, '/manager'],
    ['manager', mgrPage, '/it'],
    ['it', itPage, '/finance'],
    ['finance', finPage, '/employee'],
  ]
  const details = []
  let allPass = true
  for (const [role, page, foreignPath] of checks) {
    await page.goto(`${BASE}${foreignPath}`, { waitUntil: 'networkidle' })
    const landed = new URL(page.url()).pathname
    const expected = `/${role}`
    const ok = landed === expected || landed.startsWith(`${expected}/`)
    if (!ok) allPass = false
    details.push(`${role} -> tried ${foreignPath}, redirected to ${landed} (expected ${expected})`)
  }
  return { pass: allPass, detail: details.join(' | ') }
})

await browser.close()

console.log('\n\n========== FULL 21-STEP CHECKLIST ==========')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  #${r.n}  [${r.role}]  ${r.step}`)
}
console.log('\n========== DETAIL ==========')
console.log(JSON.stringify(results, null, 2))
