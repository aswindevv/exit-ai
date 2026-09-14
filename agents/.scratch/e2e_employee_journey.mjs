// One-shot Playwright verification of the employee journey (see task).
// Scoped locators only -- every selector targets a specific row/field by
// identity (employee id, task title), never .first()/.last() on a
// multi-row list, per the "prior test corrupted data" instruction.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const EMAIL = 'emp013@gmail.com'
const PASSWORD = 'Emp013@'

const results = []
function record(step, pass, evidence) {
  results.push({ step, pass, evidence })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${step} -- ${evidence}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('  [browser console error]', msg.text())
})

let activateExitResponse = null
page.on('response', async (res) => {
  if (res.url().includes('/activate-exit')) {
    try { activateExitResponse = await res.json() } catch { /* ignore */ }
  }
})

try {
  // ---------- Step 1: LOGIN ----------
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill(EMAIL)
  await page.locator('#login-password').fill(PASSWORD)
  await page.locator('button.login-submit').click()
  await page.waitForURL('**/employee/resignation', { timeout: 15000 })
  const step1a = page.url().endsWith('/employee/resignation')

  // Try to reach the dashboard directly -- must bounce back to resignation.
  await page.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
  await page.waitForURL('**/employee/resignation', { timeout: 15000 })
  const step1b = page.url().endsWith('/employee/resignation')

  record('1. LOGIN (fresh employee -> resignation gate, dashboard unreachable)',
    step1a && step1b,
    `after login url=${step1a ? '/employee/resignation' : page.url()}; direct /employee visit redirected to ${page.url()}`)

  // ---------- Step 2: RESIGNATION ----------
  const lastDay = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  await page.locator('#resign-last-day').fill(lastDay)
  await page.locator('#resign-reason').fill('Playwright e2e journey test.')
  await page.locator('button.login-submit').click()
  await page.waitForURL('**/employee', { timeout: 20000 })
  // give the awaited /activate-exit fetch a moment to resolve if it raced the nav
  await page.waitForTimeout(500)

  record('2. RESIGNATION (submit -> case created, pipeline triggered)',
    page.url().replace(/\/$/, '').endsWith('/employee'),
    `landed on ${page.url()}; /activate-exit response=${JSON.stringify(activateExitResponse)}`)

  // ---------- Step 3: DASHBOARD ----------
  await page.waitForSelector('.gauge-card', { timeout: 15000 })
  const checklistRows = await page.locator('.card:has(.card-title:text-is("My checklist")) .list .row').count()
  const progressText = await page.locator('.gauge span').innerText()
  const lastDayChip = await page.locator('.chip, .tag, span', { hasText: 'Last day' }).first().innerText().catch(() => '')

  record('3. DASHBOARD (own checklist + progress + timeline, real data)',
    checklistRows > 0,
    `checklist rows=${checklistRows}, progress=${progressText}, chip="${lastDayChip}"`)

  // ---------- Step 5: NAV (checked before task-4 DB probe, doesn't depend on it) ----------
  const navTargets = [
    { label: 'My tasks', path: '/employee/tasks', cardTitle: 'My tasks' },
    { label: 'Documents', path: '/employee/documents', cardTitle: 'Documents' },
    { label: 'Knowledge transfer', path: '/employee/knowledge-transfer', cardTitle: 'Knowledge transfer' },
    { label: 'Exit interview', path: '/employee/exit-interview', cardTitle: 'Exit interview' },
    { label: 'Timeline', path: '/employee/timeline', cardTitle: 'Exit timeline' },
    { label: 'Help and support', path: '/employee/help', cardTitle: 'Help and support' },
  ]
  const navResults = []
  for (const t of navTargets) {
    await page.locator('.sidebar .nav a', { hasText: t.label }).click()
    await page.waitForURL(`**${t.path}`, { timeout: 10000 })
    await page.waitForSelector(`.card-title:text-is("${t.cardTitle}")`, { timeout: 10000 })
    navResults.push(`${t.label}->${page.url().endsWith(t.path) ? 'OK' : 'BAD-URL'}`)
  }
  record('5. NAV (each item routes to a real page/empty state, no dead links)',
    navResults.every((r) => r.includes('OK')),
    navResults.join('; '))

  // ---------- Step 4: TASKS (mark a task done) ----------
  await page.locator('.sidebar .nav a', { hasText: 'My tasks' }).click()
  await page.waitForURL('**/employee/tasks', { timeout: 10000 })
  const tasksCard = page.locator('.card:has(.card-title:text-is("My tasks"))')
  await tasksCard.waitFor({ timeout: 10000 })
  const taskRowCount = await tasksCard.locator('.row').count()
  const hasDoneControl = await tasksCard.locator('.row input[type="checkbox"], .row button').count()
  record('4. TASKS (mark a task done -> writes status, progress updates)',
    false,
    `employee Tasks page is READ-ONLY: ${taskRowCount} real task row(s) rendered for this case, ${hasDoneControl} clickable done-toggle found (no button/checkbox in EmployeePages.jsx Tasks()); exit_tasks RLS has UPDATE policies only for manager/it stages (0008_task_action_updates.sql) -- no employee UPDATE policy or UI control exists. Feature not built, not a bug in this run.`)

  // ---------- Step 6: EXIT INTERVIEW ----------
  await page.locator('.sidebar .nav a', { hasText: 'Exit interview' }).click()
  await page.waitForURL('**/employee/exit-interview', { timeout: 10000 })
  const interviewCard = page.locator('.card:has(.card-title:text-is("Exit interview"))')
  await interviewCard.waitFor({ timeout: 10000 })
  const interviewBody = await interviewCard.innerText()
  const hasForm = await interviewCard.locator('form, textarea, input[type="text"]').count()
  record('6. EXIT INTERVIEW (submit form -> exit_interviews, sentiment hidden from employee)',
    false,
    `page is a static Placeholder ("${interviewBody.replace(/\n/g, ' ')}"), ${hasForm} form fields present; exit_interviews has only an HR-select RLS policy (0002_rls.sql) and no employee INSERT policy -- submission path does not exist yet. (Sentiment/summary hiding itself would pass by construction since nothing is shown at all.)`)

  // ---------- Step 7: ASK ----------
  await page.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.ask-input', { timeout: 15000 })

  async function askAndCapture(question) {
    const respPromise = page.waitForResponse((r) => r.url().includes('/functions/v1/ask'), { timeout: 20000 })
    await page.locator('.ask-input').fill(question)
    await page.locator('.strip--top button', { hasText: 'Ask' }).click()
    const resp = await respPromise
    const body = await resp.json().catch(() => null)
    await page.waitForFunction(
      () => !document.querySelector('.strip-body')?.textContent.includes('Ask me anything'),
      { timeout: 10000 },
    ).catch(() => {})
    const domText = await page.locator('.strip-body').first().innerText().catch(() => '')
    return { body, domText }
  }

  const q1 = await askAndCapture('When do I get my final settlement?')
  const q2 = await askAndCapture('What is the capital of France?')

  record('7. ASK (cited answer for real question, refusal for out-of-scope)',
    Boolean(q1.body?.answer) && !q1.body?.refused && Boolean(q2.body?.refused || /don't have|do not have/i.test(q2.body?.answer ?? '')),
    `Q1 /ask response=${JSON.stringify(q1.body)} (dom="${q1.domText}") | Q2(out-of-scope) /ask response=${JSON.stringify(q2.body)} (dom="${q2.domText}")`)

  // ---------- Step 8: ACCESS (HR-only fields hidden) ----------
  const uiText = await page.locator('body').innerText()
  const leaksInUi = /risk_score|risk_level|rehire_eligible|sentiment/i.test(uiText)

  const queryResult = await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.js')
    const { data, error } = await mod.supabase
      .from('exit_cases')
      .select('id, risk_score, risk_level, rehire_eligible')
      .limit(5)
    return { data, error: error?.message }
  })

  record('8. ACCESS (employee cannot see HR-only fields, in UI or via query)',
    !leaksInUi && Array.isArray(queryResult.data) && queryResult.data.length === 0,
    `UI text scan leaks=${leaksInUi}; direct exit_cases query from employee session -> rows=${JSON.stringify(queryResult.data)} error=${queryResult.error ?? 'none'} (expect 0 rows: employee has no base-table SELECT policy)`)

} catch (err) {
  record('UNEXPECTED ERROR', false, String(err && err.stack || err))
} finally {
  await browser.close()
}

console.log('\n=== SUMMARY ===')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.step}`)
