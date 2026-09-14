// Follow-up for Task D: fixes a script-only locator bug in step 6's evidence
// capture, and gathers UI-level evidence for the step 12/13 manager finding
// (duplicate "Aravidhan" profiles; the demo login is bound to the one with
// zero assigned reports). Read-only / same scoped-action rules as the main
// script. Does not repeat any state-changing action already done.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const results = []
function record(n, role, step, pass, detail) { results.push({ n, role, step, pass, detail }) }

const browser = await chromium.launch()

// ---- Step 6 re-check: fixed locator (no strict-mode collision) ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('emp016@gmail.com')
  await page.locator('#login-password').fill('Emp016@')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.goto(`${BASE}/employee/exit-interview`, { waitUntil: 'networkidle' })
  const formFieldCount = await page.locator('input, textarea, form').count()
  const cardText = await page.locator('.card.card--pad, .card:not(.sidebar)').last().innerText()
  record(6, 'EMPLOYEE', 'Exit interview form: fill+submit -> writes to exit_interviews; sees only "submitted", not analysis',
    false,
    `structural FAIL: ExitInterview() (src/routes/employee/EmployeePages.jsx:361-368) renders a static <Placeholder> with zero writable form fields (inputs/textareas/forms on page: ${formFieldCount}). Rendered card text: "${cardText.trim()}". No employee-facing exit-interview submission UI exists anywhere in the frontend -- there is no code path from the employee dashboard that writes to exit_interviews.`)
  await page.close()
}

// ---- Step 12/13 re-check: UI evidence for the duplicate-profile bug ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('aravidhan@gmail.com')
  await page.locator('#login-password').fill('aravidhan@')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  const subtitle = await page.locator('.page-head, header').first().innerText().catch(() => '(no page-head found)')
  const teamRows = await page.locator('.card:has(.card-title:text-is("My team\'s exits")) .row').count()
  const ktRows = await page.locator('.card:has(.card-title:text-is("KT approvals")) .row--split').count()
  const signRows = await page.locator('.card:has(.card-title:text-is("Clearances to sign")) .row--split').count()

  record(12, 'MANAGER', "Login -> sees ONLY their own reports' cases",
    false,
    `REAL BUG (data/seeding, not RLS): logging in as aravidhan@gmail.com renders an empty "My team's exits" table (0 rows). SQL confirms two duplicate manager profiles both named "Aravidhan" exist: id 9c11cefb-5a3a-4da4-aa60-7a4d4aeb2560 (linked to auth email aravidhan@gmail.com, the documented demo login) has 0 exit_cases assigned as manager_id, while id 7a43e75e-7b0e-46ad-8d6e-f278e9b3f81e (linked to a DIFFERENT, undocumented auth email aravidhan@company.com) is the manager_id on all 15 real seeded exit cases. The RLS/view isolation itself is correctly scoped (manager_case_view filters by auth.uid()=manager_id) -- the bug is that the demo credential in CLAUDE.md points at the wrong duplicate profile, so the intended demo manager sees no reports at all. Page subtitle observed: "${subtitle.trim().slice(0, 200)}"`)

  record(13, 'MANAGER', 'KT approval / Approve / Sign actions work',
    false,
    `Untestable as a direct consequence of #12: with 0 reports loaded, ManagerLayout's load() derives caseIds=[] and therefore tasks=[], so KT approvals and Clearances-to-sign are also empty for this login (KT approvals rows=${ktRows}, Clearances-to-sign rows=${signRows}, team rows=${teamRows}). The approve/sign button code itself (useApprove hook, ManagerPages.jsx:20-40) is structurally identical to IT's confirmed-working Approve action (step 16 PASS), so once the credential/profile mismatch from #12 is fixed this action would likely work -- but it cannot be exercised as a real user via the documented aravidhan@gmail.com login today because that account has no pending rows to act on.`)

  await page.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
