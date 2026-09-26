/**
 * STEP 3: Strict browser e2e journey for a disposable employee.
 * Run from repo root:
 *   node e2e_browser.mjs
 * Requires: npm run dev (port 5173) + python -m agents.service (port 8787).
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

process.loadEnvFile()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = 'http://localhost:5173'
const SERVICE = 'http://localhost:8787'
const TIMEOUT = 30_000

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── helpers ────────────────────────────────────────────────────────────────

const results = []
function step(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

/**
 * Login via Supabase admin-generated magic link — no password needed.
 * page.goto() resolves after Supabase redirects to APP with #access_token hash.
 * The caller's waitForURL() then waits for the app to process auth and redirect.
 */
async function loginAs(page, email) {
  const { data, error } = await db.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: APP + '/' },
  })
  if (error) throw new Error(`generateLink(${email}): ${error.message}`)
  await page.goto(data.properties.action_link)
}

async function logout(page) {
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${APP}/`)
  await page.waitForTimeout(500)
}

/**
 * Poll DB until tasks with the given stage and status exist for our case.
 * Returns the rows, or [] if none appear within maxWaitMs.
 */
async function waitForAgentTasks(caseId, stage, status = 'pending', maxWaitMs = 60_000) {
  if (!caseId) return []
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const { data } = await db.from('exit_tasks')
      .select('id, title')
      .eq('case_id', caseId)
      .eq('stage', stage)
      .eq('status', status)
    if (data?.length > 0) return data
    await new Promise(r => setTimeout(r, 2000))
  }
  return []
}

/**
 * Wait for the employee's group header to be visible, then click ALL non-disabled
 * buttons with buttonText in that employee's section (for multi-approve steps).
 * Returns count clicked. Always waits for header first so no timing race.
 */
async function clickInEmployeeGroup(page, employeeName, buttonText) {
  // .first() avoids strict-mode violation when the name appears in multiple sections.
  await page.locator('.employee-group-header__name', { hasText: employeeName })
    .first().waitFor({ state: 'visible', timeout: TIMEOUT })
  return await page.evaluate(([name, btnText]) => {
    const nameEl = [...document.querySelectorAll('.employee-group-header__name')]
      .find(el => el.textContent.trim() === name)
    if (!nameEl) return 0
    const header = nameEl.closest('[data-group-header="true"]')
    if (!header) return 0
    let clicked = 0
    let el = header.nextElementSibling
    while (el) {
      if (el.hasAttribute('data-group-header')) break
      const btns = [...el.querySelectorAll('button')]
        .filter(b => b.textContent.trim() === btnText && !b.disabled)
      btns.forEach(b => { b.click(); clicked++ })
      el = el.nextElementSibling
    }
    return clicked
  }, [employeeName, buttonText])
}

/**
 * Click only the FIRST matching button in the employee's section.
 * Used for Reject which opens window.prompt() — we only want one prompt.
 */
async function clickFirstInEmployeeGroup(page, employeeName, buttonText) {
  await page.locator('.employee-group-header__name', { hasText: employeeName })
    .first().waitFor({ state: 'visible', timeout: TIMEOUT })
  return await page.evaluate(([name, btnText]) => {
    const nameEl = [...document.querySelectorAll('.employee-group-header__name')]
      .find(el => el.textContent.trim() === name)
    if (!nameEl) return 0
    const header = nameEl.closest('[data-group-header="true"]')
    if (!header) return 0
    let el = header.nextElementSibling
    while (el) {
      if (el.hasAttribute('data-group-header')) break
      const btn = [...el.querySelectorAll('button')]
        .find(b => b.textContent.trim() === btnText && !b.disabled)
      if (btn) { btn.click(); return 1 }
      el = el.nextElementSibling
    }
    return 0
  }, [employeeName, buttonText])
}

// ── pre-flight checks ──────────────────────────────────────────────────────

async function checkService() {
  try {
    const r = await fetch(`${SERVICE}/health`).catch(() => null)
    return !!r
  } catch { return false }
}

// ── pick a disposable employee ─────────────────────────────────────────────

async function pickFreshEmployee() {
  const { data: cased } = await db.from('exit_cases').select('employee_id')
  const usedIds = new Set((cased || []).map(r => r.employee_id))
  const { data: employees } = await db.from('profiles').select('*').eq('role', 'employee')
  const fresh = (employees || []).find(e => !usedIds.has(e.employee_id))
  if (!fresh) throw new Error('No seeded employee without an exit case — re-seed first.')
  return fresh
}

// ── staff emails from profiles ─────────────────────────────────────────────

async function getStaffEmails() {
  const { data, error } = await db
    .from('profiles')
    .select('email, role')
    .in('role', ['manager', 'hr', 'it', 'finance'])
  if (error) throw new Error(`profiles query: ${error.message}`)
  const byRole = Object.fromEntries((data || []).map(p => [p.role, p.email]))
  const missing = ['manager', 'hr', 'it', 'finance'].filter(r => !byRole[r])
  if (missing.length) throw new Error(`Missing staff roles in profiles: ${missing.join(', ')}`)
  return byRole
}

// ── test-document generator ────────────────────────────────────────────────

const PYTHON = fs.existsSync(path.join(__dirname, 'agents', '.venv', 'Scripts', 'python.exe'))
  ? path.join(__dirname, 'agents', '.venv', 'Scripts', 'python.exe')
  : fs.existsSync(path.join(__dirname, 'agents', '.venv', 'bin', 'python'))
    ? path.join(__dirname, 'agents', '.venv', 'bin', 'python')
    : 'python'

function makeTestDocs(employeeName, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const ndaPath = path.join(outDir, 'nda.png')
  const arfPath = path.join(outDir, 'arf.png')

  execFileSync(
    PYTHON, ['-m', 'agents.spokes.doc_collection', '--make-test-doc', ndaPath, employeeName],
    { cwd: __dirname, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
  )

  const arfScript = `
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (900, 420), "white")
draw = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("arial.ttf", 28)
except Exception:
    font = ImageFont.load_default()
lines = [
    "ASSET RETURN FORM",
    "",
    "Employee: ${employeeName}",
    "I hereby confirm all company assets have been returned.",
    "Assets returned: Laptop, access card.",
    "",
    "Signature: ____________________   Date: 13-Sep-2026",
]
draw.multiline_text((30, 30), "\\n".join(lines), fill="black", font=font, spacing=12)
img.save(r"${arfPath.replace(/\\/g, '\\\\')}")
print("wrote arf:", r"${arfPath.replace(/\\/g, '\\\\')}")
`.trim()

  execFileSync(PYTHON, ['-c', arfScript], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })

  return { ndaPath, arfPath }
}

// ── cleanup ────────────────────────────────────────────────────────────────

async function cleanup(employeeId, caseId, tmpDir) {
  if (caseId) {
    await db.from('agent_runs').delete().eq('case_id', caseId)
    await db.from('compliance_checks').delete().eq('case_id', caseId)
    await db.from('kt_reviews').delete().eq('case_id', caseId)
    await db.from('exit_interviews').delete().eq('case_id', caseId)
    const { data: docs } = await db.from('case_documents').select('file_path').eq('case_id', caseId)
    if (docs?.length) {
      await db.storage.from('exit-documents').remove(docs.map(d => d.file_path))
    }
    await db.from('case_documents').delete().eq('case_id', caseId)
    await db.from('exit_tasks').delete().eq('case_id', caseId)
    await db.from('analytics_insights').delete().eq('case_id', caseId)
    await db.from('exit_cases').delete().eq('id', caseId)
  }
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const serviceOk = await checkService()
  if (!serviceOk) {
    step('Agent service reachable', false, 'http://localhost:8787 not responding — start with: python -m agents.service')
  }

  let employee, staff, docs, caseId
  const tmpDir = path.join(__dirname, '.e2e_tmp')

  try {
    employee = await pickFreshEmployee()
    step('Pick fresh employee', true, `${employee.employee_id} (${employee.email})`)
  } catch (err) {
    step('Pick fresh employee', false, err.message)
    return summarize()
  }

  try {
    staff = await getStaffEmails()
    step('Staff accounts found', true, Object.entries(staff).map(([r, e]) => `${r}: ${e}`).join(', '))
  } catch (err) {
    step('Staff accounts found', false, err.message)
    return summarize()
  }

  try {
    docs = makeTestDocs(employee.full_name, tmpDir)
    step('Generate test docs', true, 'nda.png + arf.png created')
  } catch (err) {
    step('Generate test docs', false, err.message)
    return summarize()
  }

  const browser = await chromium.launch({ headless: false, slowMo: 200 })
  const page = await browser.newPage()
  page.setDefaultTimeout(TIMEOUT)

  try {
    // ── 1. Employee: resign ──────────────────────────────────────────────
    try {
      await loginAs(page, employee.email)
      // EmployeeLayout redirects to /resignation when there is no exit case
      await page.waitForURL(`${APP}/employee/resignation`, { timeout: TIMEOUT })
      const lastDay = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      await page.locator('#resign-last-day').fill(lastDay)
      await page.locator('#resign-reason').fill('Better opportunity elsewhere')
      await page.locator('button[type="submit"]').click()
      await page.waitForURL(`${APP}/employee`, { timeout: TIMEOUT })
      step('Employee: resign', true)
    } catch (err) {
      step('Employee: resign', false, err.message)
    }

    // Wait for /activate-exit to run and create HR checklist tasks
    if (serviceOk) await page.waitForTimeout(5000)

    // Get case_id (needed for DB polling and cleanup)
    const { data: caseRow } = await db
      .from('exit_cases')
      .select('id')
      .eq('employee_id', employee.employee_id)
      .maybeSingle()
    caseId = caseRow?.id

    // submit-resignation picks manager/hr by limit(1) (first DB row),
    // which may differ from the accounts our test actually logs in as.
    // Patch manager_id and hr_id so role-scoped views show this case.
    try {
      const [{ data: mgrP }, { data: hrP }] = await Promise.all([
        db.from('profiles').select('id').eq('email', staff.manager).single(),
        db.from('profiles').select('id').eq('email', staff.hr).single(),
      ])
      if (caseId && mgrP?.id && hrP?.id) {
        await db.from('exit_cases').update({ manager_id: mgrP.id, hr_id: hrP.id }).eq('id', caseId)
      }
    } catch {
      // non-fatal — case will still proceed, just scoped-view steps may fail
    }

    // ── 2. Employee: complete HR tasks ───────────────────────────────────
    try {
      await page.goto(`${APP}/employee/tasks`)
      // HR tasks may appear after /activate-exit finishes. Reload in a loop until none remain.
      let totalClicked = 0
      for (let attempt = 0; attempt < 10; attempt++) {
        await page.reload()
        await page.waitForTimeout(1000)
        const buttons = page.locator('button.mark-done')
        const n = await buttons.count()
        if (n === 0) break
        for (let i = 0; i < n; i++) {
          if (await buttons.nth(i).isVisible()) {
            await buttons.nth(i).click()
            totalClicked++
            await page.waitForTimeout(1000)
          }
        }
      }
      const remaining = await page.locator('button.mark-done').count()
      if (remaining > 0) throw new Error(`${remaining} mark-done buttons still visible after clicking`)
      step('Employee: complete HR tasks', true, `${totalClicked} tasks marked done`)
    } catch (err) {
      step('Employee: complete HR tasks', false, err.message)
    }

    // ── 3. Employee: upload NDA ──────────────────────────────────────────
    try {
      await page.goto(`${APP}/employee/documents`)
      const ndaLabel = page.locator('div.doc-card', { hasText: 'NDA' }).locator('label.doc-card-action')
      await ndaLabel.waitFor({ timeout: TIMEOUT })
      const [ndaChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        ndaLabel.click(),
      ])
      await ndaChooser.setFiles(docs.ndaPath)
      await page.locator('div.doc-card', { hasText: 'NDA' }).locator('.tag').filter({ hasText: /Pending|Validated/ }).waitFor({ timeout: TIMEOUT })
      step('Employee: upload NDA', true)
    } catch (err) {
      step('Employee: upload NDA', false, err.message)
    }

    // ── 4. Employee: upload Asset Return Form ────────────────────────────
    try {
      await page.goto(`${APP}/employee/documents`)
      const arfLabel = page.locator('div.doc-card', { hasText: 'Asset Return Form' }).locator('label.doc-card-action')
      await arfLabel.waitFor({ timeout: TIMEOUT })
      const [arfChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        arfLabel.click(),
      ])
      await arfChooser.setFiles(docs.arfPath)
      await page.locator('div.doc-card', { hasText: 'Asset Return Form' }).locator('.tag').filter({ hasText: /Pending|Validated/ }).waitFor({ timeout: TIMEOUT })
      step('Employee: upload Asset Return Form', true)
    } catch (err) {
      step('Employee: upload Asset Return Form', false, err.message)
    }

    // Wait for OCR agent, then verify both docs validated
    if (serviceOk) {
      await page.waitForTimeout(6000)
      try {
        await page.goto(`${APP}/employee/documents`)
        await page.locator('div.doc-card', { hasText: 'NDA' }).locator('.tag').filter({ hasText: 'Validated' }).waitFor({ timeout: 15_000 })
        await page.locator('div.doc-card', { hasText: 'Asset Return Form' }).locator('.tag').filter({ hasText: 'Validated' }).waitFor({ timeout: 5_000 })
        step('OCR: both docs Validated (employee view)', true)
      } catch (err) {
        step('OCR: both docs Validated (employee view)', false, err.message)
      }
    } else {
      step('OCR: both docs Validated (employee view)', false, 'Agent service not running — skipped')
    }

    // ── 5. Employee: submit exit interview ───────────────────────────────
    try {
      await page.goto(`${APP}/employee/exit-interview`)
      await page.locator('#ei-reason').fill('Better compensation elsewhere')
      await page.locator('#ei-recommend').selectOption('yes')
      await page.locator('#ei-feedback').fill('Great team, would recommend the culture.')
      const t0 = Date.now()
      await page.locator('button[type="submit"]').click()
      await page.locator('text=Thanks — your exit interview has been submitted').waitFor({ timeout: 5_000 })
      const elapsed = Date.now() - t0
      step('Employee: exit interview submitted', elapsed < 5000, `${elapsed}ms (must be < 5s)`)
    } catch (err) {
      step('Employee: exit interview submitted', false, err.message)
    }

    // Wait for the exit interview agent to generate KT tasks for the manager
    // (LLM call — can take up to 20s). DB-poll instead of a blind sleep.
    if (serviceOk && caseId) {
      console.log('  Waiting for agent to generate KT tasks…')
      const ktTasks = await waitForAgentTasks(caseId, 'manager', 'pending', 60_000)
      console.log(`  KT tasks ready: ${ktTasks.length}`)
    } else {
      await page.waitForTimeout(5000)
    }

    // ── 6. Manager: reject KT plan with reason ───────────────────────────
    try {
      await logout(page)
      await loginAs(page, staff.manager)
      await page.waitForURL(`${APP}/manager`, { timeout: TIMEOUT })
      await page.goto(`${APP}/manager/kt-approvals`)

      // Register dialog handler BEFORE clicking; clickFirstInEmployeeGroup
      // waits for the header to be visible, then clicks exactly one Reject.
      page.once('dialog', async d => d.accept('KT document incomplete — missing escalation contacts'))
      const rejectClicked = await clickFirstInEmployeeGroup(page, employee.full_name, 'Reject')
      if (!rejectClicked) throw new Error(`No Reject button found for ${employee.full_name}`)
      await page.waitForTimeout(5000) // service call: /reject-manager-task

      await page.reload()
      // Many other employees' tasks may show "Escalated to HR"; .first() avoids strict mode.
      await page.locator('.tag', { hasText: 'Escalated to HR' }).first().waitFor({ timeout: 10_000 })
      step('Manager: reject KT plan', true)
    } catch (err) {
      step('Manager: reject KT plan', false, err.message)
    }

    // ── 7. HR: re-route escalation ───────────────────────────────────────
    try {
      await logout(page)
      await loginAs(page, staff.hr)
      await page.waitForURL(`${APP}/hr`, { timeout: TIMEOUT })
      await page.goto(`${APP}/hr/escalations`)

      // Scope re-route to our employee's escalation card
      const card = page.locator('.hr-escalation-card', { hasText: employee.full_name })
      await card.waitFor({ timeout: TIMEOUT })
      await card.locator('button', { hasText: 'Re-route to manager' }).click()

      // ConfirmDialog: click the primary action button
      await page.locator('button.hr-button--primary', { hasText: 'Re-route' }).waitFor({ timeout: 10_000 })
      await page.locator('button.hr-button--primary', { hasText: 'Re-route' }).click()
      await page.locator('.hr-toast--success').waitFor({ timeout: 10_000 })
      step('HR: re-route escalation', true)
    } catch (err) {
      step('HR: re-route escalation', false, err.message)
    }

    // ── 8. HR: verify docs Validated (while we're logged in as HR) ───────
    if (serviceOk) {
      try {
        const { data: caseData } = await db.from('exit_cases').select('id').eq('employee_id', employee.employee_id).maybeSingle()
        if (caseData) {
          await page.goto(`${APP}/hr/exits/${caseData.id}?tab=documents`)
          await page.locator('text=Validated').first().waitFor({ timeout: 15_000 })
          step('OCR: docs Validated (HR view)', true)
        } else {
          step('OCR: docs Validated (HR view)', false, 'Case not found')
        }
      } catch (err) {
        step('OCR: docs Validated (HR view)', false, err.message)
      }
    } else {
      step('OCR: docs Validated (HR view)', false, 'Agent service not running — skipped')
    }

    // ── 9. Manager: approve KT ───────────────────────────────────────────
    // Each Review click triggers approveTask → /manager-approve (non-fatal).
    // When the last task is approved, /manager-approve advances the case to IT.
    // By then state = 'signed' so the Sign clearance button is hidden — skip it;
    // IT task creation (confirmed below) proves the advance happened.
    try {
      await logout(page)
      await loginAs(page, staff.manager)
      await page.waitForURL(`${APP}/manager`, { timeout: TIMEOUT })
      await page.goto(`${APP}/manager/kt-approvals`)

      let reviewCount = 0
      for (let attempt = 0; attempt < 5; attempt++) {
        const n = await clickInEmployeeGroup(page, employee.full_name, 'Review')
        reviewCount += n
        if (n === 0) break
        // Give async approveTask + /manager-approve time to complete
        await page.waitForTimeout(4000)
        await page.reload()
      }
      if (!reviewCount) throw new Error(`No Review buttons found for ${employee.full_name} on KT approvals`)

      // Confirm IT advancement via DB poll
      if (serviceOk && caseId) {
        console.log('  Waiting for IT tasks to be generated…')
        const itTasks = await waitForAgentTasks(caseId, 'it', 'pending', 60_000)
        console.log(`  IT tasks ready: ${itTasks.length}`)
        if (!itTasks.length) throw new Error('IT tasks not generated — /manager-approve may have failed')
      } else {
        await page.waitForTimeout(5000)
      }
      step('Manager: approve KT tasks', true, `${reviewCount} KT tasks approved`)
    } catch (err) {
      step('Manager: approve KT tasks', false, err.message)
    }

    // ── 10. IT: approve all tasks ────────────────────────────────────────
    try {
      await logout(page)
      await loginAs(page, staff.it)
      await page.waitForURL(`${APP}/it`, { timeout: TIMEOUT })

      // clickInEmployeeGroup waits for our employee's header to appear,
      // so no extra timeout needed. Loop covers async IT task creation.
      let approveCount = 0
      for (let attempt = 0; attempt < 5; attempt++) {
        const n = await clickInEmployeeGroup(page, employee.full_name, 'Approve')
        approveCount += n
        if (n === 0) break
        await page.waitForTimeout(2000)
        await page.reload()
      }
      if (!approveCount) throw new Error(`No Approve buttons found for ${employee.full_name} on IT page`)
      step('IT: approve all tasks', true, `${approveCount} tasks approved`)
    } catch (err) {
      step('IT: approve all tasks', false, err.message)
    }

    // Wait for compliance/finance agent to run
    if (serviceOk && caseId) {
      console.log('  Waiting for finance tasks to be generated…')
      await waitForAgentTasks(caseId, 'finance', 'pending', 30_000)
    } else {
      await page.waitForTimeout(5000)
    }

    // ── 11. Finance: settle dues ─────────────────────────────────────────
    try {
      await logout(page)
      await loginAs(page, staff.finance)
      await page.waitForURL(`${APP}/finance`, { timeout: TIMEOUT })
      await page.waitForTimeout(1500)

      // Scope settle button to our employee's row
      const financeRow = page.locator('.row', { hasText: employee.full_name })
        .filter({ has: page.locator('button', { hasText: 'Settle dues' }) })
      await financeRow.waitFor({ timeout: TIMEOUT })
      await financeRow.locator('button', { hasText: 'Settle dues' }).click()
      await page.waitForTimeout(3000)
      step('Finance: settle dues', true)
    } catch (err) {
      step('Finance: settle dues', false, err.message)
    }

    // Wait for finance-settle-check and compliance agents to run
    if (serviceOk) await page.waitForTimeout(8000)

    // ── 12. HR: issue relieving letter ───────────────────────────────────
    try {
      await logout(page)
      await loginAs(page, staff.hr)
      await page.waitForURL(`${APP}/hr`, { timeout: TIMEOUT })
      await page.goto(`${APP}/hr/relieving-letters`)
      await page.waitForTimeout(1000)

      // Scope Issue letter button to our employee's article in the list
      const letterArticle = page.locator('.hr-letter-list article', { hasText: employee.full_name })
      await letterArticle.waitFor({ timeout: TIMEOUT })
      await letterArticle.locator('button', { hasText: 'Issue letter' }).click()

      // ConfirmDialog — click primary confirm button
      await page.locator('button.hr-button--primary', { hasText: 'Issue letter' }).waitFor({ timeout: 5_000 })
      await page.locator('button.hr-button--primary', { hasText: 'Issue letter' }).click()
      await page.locator('.hr-toast--success').waitFor({ timeout: 10_000 })
      step('HR: issue relieving letter', true)
    } catch (err) {
      step('HR: issue relieving letter', false, err.message)
    }

    // ── 13. Employee: completion screen + timeline ───────────────────────
    try {
      await logout(page)
      await loginAs(page, employee.email)
      // Employee now has a case → goes to /employee dashboard (not /resignation)
      await page.waitForURL(`${APP}/employee`, { timeout: TIMEOUT })
      // ExitComplete renders on Dashboard when relieving_letter_issued === true
      await page.locator('text=your exit is complete').waitFor({ state: 'visible', timeout: TIMEOUT })
      step('Employee: completion screen shown', true)
    } catch (err) {
      step('Employee: completion screen shown', false, err.message)
    }

    // Timeline: all 5 nodes done + real relieving date
    try {
      await page.goto(`${APP}/employee/timeline`)
      const doneNodes = page.locator('.tl-node--done')
      await doneNodes.first().waitFor({ timeout: TIMEOUT })
      const doneCount = await doneNodes.count()
      if (doneCount !== 5) throw new Error(`Expected 5 done nodes, got ${doneCount}`)

      const relievingNode = page.locator('.tl-node', { hasText: 'Relieving' })
      const dateText = await relievingNode.locator('.tl-date').textContent()
      if (!dateText || dateText.trim() === '' || dateText === 'In progress') {
        throw new Error(`Relieving node shows "${dateText}" instead of a real date`)
      }
      step('Employee: timeline 5/5 done with real relieving date', true, `Relieving date: "${dateText.trim()}"`)
    } catch (err) {
      step('Employee: timeline 5/5 done with real relieving date', false, err.message)
    }

    // My-exit page: stages list
    try {
      await page.goto(`${APP}/employee/my-exit`)
      const completedStages = page.locator('.employee-my-exit__stages li.is-done')
      await completedStages.first().waitFor({ timeout: TIMEOUT })
      const doneCount = await completedStages.count()
      if (doneCount < 5) throw new Error(`Expected ≥5 is-done stages, got ${doneCount}`)
      step('Employee: my-exit shows 5 stages done', true)
    } catch (err) {
      step('Employee: my-exit shows 5 stages done', false, err.message)
    }

  } finally {
    await browser.close()

    // ── 14. Cleanup ───────────────────────────────────────────────────────
    try {
      const { data: caseData } = await db
        .from('exit_cases').select('id').eq('employee_id', employee.employee_id).maybeSingle()
      await cleanup(employee.employee_id, caseData?.id, tmpDir)

      const { data: remaining } = await db.from('exit_cases').select('id')
      step('Cleanup: test data deleted', true, `${remaining?.length ?? '?'} cases remain`)
    } catch (err) {
      step('Cleanup', false, err.message)
    }
  }

  summarize()
}

function summarize() {
  console.log('\n' + '='.repeat(60))
  console.log('RESULTS:')
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
  }
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exitCode = 1
})
