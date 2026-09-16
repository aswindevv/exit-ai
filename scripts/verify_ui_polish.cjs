// Scoped browser check for the three presentation changes:
//   1. Exit-complete header block is horizontally centred (Emp001, completed case).
//   2. The assistant answers from the RE-INGESTED exit policy (a §6.3 fact that
//      only exists in the updated document).
//   3. The Exit-interview form renders as a styled card, keeps its required-field
//      guard, and still writes to exit_interviews.
// The interview submit is disposable: the row it creates is deleted again at the
// end, restoring Emp004's case to "no interview submitted".
//   node scripts/verify_ui_polish.cjs [baseUrl]
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

process.loadEnvFile()

// 5173, not 5174: agents/service.py's ALLOWED_ORIGIN is http://localhost:5173,
// so the interview submit's agent-service call only clears CORS from that origin.
const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = 'scripts/clearance_screens'
const DONE_ACCOUNT = { email: 'emp001@gmail.com', password: 'Emp001@' }
const FORM_ACCOUNT = { email: 'emp004@gmail.com', password: 'Emp004@' }
const FORM_CASE = 'Emp004' // Zoya Sharma — in progress, no interview submitted

// A fact that exists ONLY in the updated policy (§6.3 Remote employees and asset
// shipping). The old ingested document had no §6 shipping section at all, so a
// correct answer here can only come from the re-embedded chunks.
const POLICY_Q = 'I work remotely — how do I return my laptop, and how far in advance must I ask IT?'
const POLICY_WANT = /shipping kit|7 days|seven days/i

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

const failures = []
const notes = []

async function login(page, account) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', account.email)
  await page.fill('#login-password', account.password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/employee/, { timeout: 20000 })
  await page.waitForTimeout(1200)
}

async function logout(page) {
  await page.evaluate(() => window.localStorage.clear())
  await page.context().clearCookies()
}

// ---------- 1. Exit-complete header centred ----------
async function checkExitComplete(page) {
  await login(page, DONE_ACCOUNT)
  const header = page.locator('.exit-done')
  if (!(await header.count())) {
    failures.push('task1: .exit-done header block not found on Emp001 exit-complete screen')
    return
  }
  const geom = await header.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const icon = el.querySelector('.exit-done-icon').getBoundingClientRect()
    const heading = el.querySelector('.card-title')
    const sub = el.querySelector('.exit-done-sub')
    const hBox = heading.getBoundingClientRect()
    const sBox = sub.getBoundingClientRect()
    const cs = (n) => getComputedStyle(n)
    // Text centring is measured from the rendered text run, not the block box:
    // a block-level <p> fills its parent regardless of text-align.
    const textRun = (n) => {
      const r = document.createRange()
      r.selectNodeContents(n)
      return r.getBoundingClientRect()
    }
    return {
      cardMid: box.left + box.width / 2,
      iconMid: icon.left + icon.width / 2,
      headingTextMid: (() => { const t = textRun(heading); return t.left + t.width / 2 })(),
      subTextMid: (() => { const t = textRun(sub); return t.left + t.width / 2 })(),
      cardTextAlign: cs(el).textAlign,
      headingJustify: cs(heading).justifyContent,
      headingDisplay: cs(heading).display,
      headingText: heading.textContent.trim(),
    }
  })
  const off = (v) => Math.abs(v - geom.cardMid)
  notes.push(
    `task1: card mid=${geom.cardMid.toFixed(1)} icon off=${off(geom.iconMid).toFixed(1)}px ` +
      `heading off=${off(geom.headingTextMid).toFixed(1)}px sub off=${off(geom.subTextMid).toFixed(1)}px ` +
      `(text-align=${geom.cardTextAlign}, heading justify=${geom.headingJustify})`,
  )
  const TOL = 2
  if (off(geom.iconMid) > TOL) failures.push(`task1: checkmark icon off-centre by ${off(geom.iconMid).toFixed(1)}px`)
  if (off(geom.headingTextMid) > TOL) failures.push(`task1: heading off-centre by ${off(geom.headingTextMid).toFixed(1)}px`)
  if (off(geom.subTextMid) > TOL) failures.push(`task1: subtitle off-centre by ${off(geom.subTextMid).toFixed(1)}px`)
  if (!/your exit is complete/i.test(geom.headingText)) failures.push(`task1: heading text changed: "${geom.headingText}"`)

  // The summary table and Download button must be untouched (left-aligned, present).
  const summaryOk = await page.locator('.card', { hasText: 'Exit summary' }).count()
  const dlOk = await page.locator('button', { hasText: 'Download relieving letter' }).count()
  if (!summaryOk) failures.push('task1: Exit summary card missing')
  if (!dlOk) failures.push('task1: Download relieving letter button missing')

  await page.screenshot({ path: `${OUT}/exit_complete_centered.png` })
}

// ---------- 2. Assistant answers from the re-ingested policy ----------
async function checkPolicyAnswer(page) {
  await page.fill('.ask-input', POLICY_Q)
  await page.click('text=Ask ↗')
  await page.waitForFunction(() => !document.body.innerText.includes('Asking…'), { timeout: 90000 })
  await page.waitForTimeout(800)
  const strip = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.strip')].find((s) => s.textContent.includes('ExitAI assistant'))
    return card?.textContent || ''
  })
  await page.screenshot({ path: `${OUT}/assistant_new_policy.png` })
  const answer = strip.replace(/\s+/g, ' ').trim()
  notes.push(`task2 Q: ${POLICY_Q}`)
  notes.push(`task2 A: ${answer}`)
  if (!POLICY_WANT.test(answer)) {
    failures.push(`task2: answer does not contain the newly-ingested §6.3 fact (shipping kit / 7 days)`)
  }
  if (!/\bSources?:/.test(answer)) failures.push('task2: answer carried no source citation')
}

// ---------- 3. Exit-interview form ----------
async function checkInterviewForm(page) {
  const { data: cases } = await db
    .from('exit_cases')
    .select('id')
    .eq('employee_id', FORM_CASE)
  const caseId = cases?.[0]?.id
  if (!caseId) {
    failures.push('task3: could not resolve Emp004 exit case id')
    return
  }
  // Start from a clean slate so the form (not the "submitted" state) renders.
  await db.from('exit_interviews').delete().eq('case_id', caseId)

  await page.goto(`${BASE}/employee/exit-interview`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const form = page.locator('form')
  if (!(await page.locator('.form-fields').count())) {
    failures.push('task3: styled .form-fields group not found — form did not render')
    return
  }

  // Header + subtitle
  const sub = await page.locator('.card-sub').first().textContent().catch(() => '')
  if (!/confidential/i.test(sub || '')) failures.push(`task3: confidential subtitle missing (got "${sub}")`)

  // All four original fields still present, with the same ids.
  for (const id of ['#ei-reason', '#ei-feedback', '#ei-recommend', '#ei-comments']) {
    if (!(await page.locator(id).count())) failures.push(`task3: field ${id} missing`)
  }

  // Inputs and the select share the app's input styling.
  const styles = await page.evaluate(() => {
    const pick = (sel) => {
      const cs = getComputedStyle(document.querySelector(sel))
      return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, pad: cs.paddingLeft, font: cs.fontSize }
    }
    const btnEl = document.querySelector('form button[type=submit]')
    const btn = getComputedStyle(btnEl)
    const btnBox = btnEl.getBoundingClientRect()
    // The form's OWN card — .card also matches cards in the 150px sidebar.
    const cardBox = btnEl.closest('.card').getBoundingClientRect()
    return {
      input: pick('#ei-reason'),
      select: pick('#ei-recommend'),
      textarea: pick('#ei-feedback'),
      btnBg: btn.backgroundColor,
      btnWidthRatio: btnBox.width / cardBox.width,
    }
  })
  const same = (a, b) => a.radius === b.radius && a.pad === b.pad && a.font === b.font
  if (!same(styles.input, styles.select)) {
    failures.push(`task3: select styling differs from text input (${JSON.stringify(styles.select)} vs ${JSON.stringify(styles.input)})`)
  }
  if (!same(styles.input, styles.textarea)) failures.push('task3: textarea styling differs from text input')
  if (styles.btnWidthRatio > 0.5) {
    failures.push(`task3: submit button still spans ${(styles.btnWidthRatio * 100).toFixed(0)}% of the card (expected a compact primary button)`)
  }
  notes.push(
    `task3: input radius=${styles.input.radius} pad=${styles.input.pad}; ` +
      `submit bg=${styles.btnBg} width=${(styles.btnWidthRatio * 100).toFixed(0)}% of card`,
  )
  await page.screenshot({ path: `${OUT}/exit_interview_form.png` })

  // Required-field guard: empty form must not submit.
  const submit = page.locator('form button[type=submit]')
  if (!(await submit.isDisabled())) failures.push('task3: submit enabled with empty required fields')
  await page.fill('#ei-reason', 'Verification run — better growth opportunity elsewhere')
  await page.waitForTimeout(150)
  if (!(await submit.isDisabled())) {
    failures.push('task3: submit enabled before the required "would you recommend" answer was given')
  }

  // Browser-level required validation still attached.
  const requiredOk = await page.evaluate(() => {
    const r = document.querySelector('#ei-reason')
    const s = document.querySelector('#ei-recommend')
    return r.required && s.required
  })
  if (!requiredOk) failures.push('task3: required attribute lost on reason/recommend')

  // Fill and submit for real.
  await page.fill('#ei-feedback', 'Disposable verification row.')
  await page.selectOption('#ei-recommend', 'yes')
  await page.fill('#ei-comments', 'Automated UI check — safe to delete.')
  await page.waitForTimeout(150)
  if (await submit.isDisabled()) failures.push('task3: submit still disabled after all required fields filled')

  await submit.click()
  await page.waitForFunction(
    () => /your exit interview has been submitted/i.test(document.body.innerText),
    { timeout: 60000 },
  ).catch(() => failures.push('task3: confirmation message never appeared after submit'))
  await page.screenshot({ path: `${OUT}/exit_interview_submitted.png` })

  const { data: row } = await db
    .from('exit_interviews')
    .select('case_id,reason_for_leaving,would_recommend')
    .eq('case_id', caseId)
    .maybeSingle()
  if (!row) failures.push('task3: no exit_interviews row written')
  else if (row.would_recommend !== true || !/better growth/i.test(row.reason_for_leaving || '')) {
    failures.push(`task3: exit_interviews row has wrong values: ${JSON.stringify(row)}`)
  } else {
    notes.push(`task3: exit_interviews row written for case ${caseId.slice(0, 8)} (reason + would_recommend=true)`)
  }

  // Dispose of the test write.
  const { error: delErr } = await db.from('exit_interviews').delete().eq('case_id', caseId)
  if (delErr) failures.push(`task3 cleanup: ${delErr.message}`)
  const { count } = await db
    .from('exit_interviews')
    .select('*', { count: 'exact', head: true })
    .eq('case_id', caseId)
  if (count !== 0) failures.push(`task3 cleanup: ${count} test rows left behind`)
  else notes.push('task3: disposable row deleted — Emp004 restored to no-interview state')
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  // Emp001's case is complete, so its overview is the exit-complete screen.
  await checkExitComplete(page)
  // The assistant lives on the in-progress overview, so switch to Emp004 —
  // which is also the account whose interview form is exercised below.
  await logout(page)
  await login(page, FORM_ACCOUNT)
  await checkPolicyAnswer(page)
  await checkInterviewForm(page)

  if (errors.length) failures.push(`console errors: ${errors.slice(0, 2).join(' | ').slice(0, 200)}`)
  await browser.close()

  notes.forEach((n) => console.log(n))
  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

run().catch((e) => { console.error(e); process.exit(1) })
