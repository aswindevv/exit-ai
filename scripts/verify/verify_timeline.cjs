// Scoped browser check for the employee Exit timeline.
//
// Reads the rendered timeline out of the DOM on real cases and asserts the
// ordering rules rather than a hard-coded picture:
//   - monotonic: no node Done after a node that isn't Done
//   - exactly one CURRENT/BLOCKED node, and it is the first non-Done one
//   - "X of 5 stages complete" matches the Done nodes actually rendered
//   - the fill stops at the last completed dot
//   - every Done node is backed by a stage whose tasks really are all done (DB)
//   - dates are chronological, and only a real completion date is ever a date
// Covers a fully-complete case, two mid-pipeline cases, and a blocked case
// (built disposably: resignation -> HR tasks done -> manager rejects -> purged).
//
//   node scripts/verify/verify_timeline.cjs [baseUrl]
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

process.loadEnvFile()

// 5173: agents/service.py pins ALLOWED_ORIGIN there, and the blocked-case
// setup drives the manager's Reject action through the agent service.
const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = 'scripts/clearance_screens'

const DONE_CASE = { empId: 'Emp001', email: 'emp001@gmail.com', password: 'Emp001@' }
const MID_CASES = [
  { empId: 'Emp015', email: 'emp015@gmail.com', password: 'Emp015@' },
  { empId: 'Emp017', email: 'emp017@gmail.com', password: 'Emp017@' },
]
const BLOCKED = { empId: 'Emp021', email: 'emp021@gmail.com', password: 'Emp021@', lastDay: '2026-12-18' }
const MANAGER = { email: 'aravidhan@company.com', password: 'aravidhan@', url: /\/manager/ }

const STAGE_KEYS = ['hr', 'manager', 'it', 'finance']
const LABEL_TO_STAGE = {
  Resignation: 'hr', 'Manager & KT': 'manager', 'IT clearance': 'it', 'Finance clearance': 'finance',
}
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

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
}

async function poll(label, fn, timeoutMs = 120000, soft = false) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > until) { if (!soft) fail(`${label}: timed out`); return null }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function login(page, acct) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', acct.email)
  await page.fill('#login-password', acct.password)
  await page.click('button.login-submit')
  await page.waitForURL(acct.url ?? /\/(employee|manager)/, { timeout: 30000 })
  await page.waitForTimeout(1200)
}

async function logout(page) {
  // about:blank has no accessible localStorage — the first logout runs before
  // any navigation, so only clear when we're actually on the app's origin.
  if (page.url().startsWith(BASE)) await page.evaluate(() => window.localStorage.clear())
  await page.context().clearCookies()
}

async function readTimeline(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.timeline')
    if (!root) return null
    const card = root.closest('.card')
    const nodes = [...root.querySelectorAll('.tl-node')].map((n) => ({
      state: n.getAttribute('data-stage-state'),
      label: n.querySelector('.tl-label')?.textContent.trim() ?? '',
      date: n.querySelector('.tl-date')?.textContent.trim() ?? '',
      hasCheck: !!n.querySelector('.tl-dot i.ti-check'),
      dotCentre: (() => {
        const d = n.querySelector('.tl-dot').getBoundingClientRect()
        return d.left + d.width / 2
      })(),
      ring: getComputedStyle(n.querySelector('.tl-dot')).boxShadow,
    }))
    const fillEl = root.querySelector('.tl-fill')
    const fill = fillEl.getBoundingClientRect()
    return {
      nodes,
      count: card.querySelector('.tl-count')?.textContent.trim() ?? '',
      legend: [...card.querySelectorAll('.tl-key')].map((k) => k.textContent.trim()),
      fillRight: fill.right,
      fillWidth: fill.width,
      rootLeft: root.getBoundingClientRect().left,
    }
  })
}

// The rule the UI must obey, restated as assertions over what it rendered.
async function assertTimeline(tl, ctx, caseId) {
  if (!tl) { fail(`${ctx}: no .timeline rendered`); return null }
  if (tl.nodes.length !== 5) fail(`${ctx}: expected 5 nodes, got ${tl.nodes.length}`)

  const states = tl.nodes.map((n) => n.state)
  const labels = tl.nodes.map((n) => n.label)
  log(`  ${ctx}: ${tl.nodes.map((n) => `${n.label}[${n.state}${n.date ? ' ' + n.date : ''}]`).join(' -> ')}`)

  // 1. Monotonic — nothing Done after something that isn't.
  const firstNotDone = states.indexOf('done') === -1 ? 0 : states.findIndex((s) => s !== 'done')
  if (firstNotDone !== -1 && states.slice(firstNotDone).includes('done')) {
    fail(`${ctx}: Done node after a non-Done node — ${states.join(',')}`)
  }

  // 2. Exactly one current/blocked, and it is the first non-Done node.
  const active = states.map((s, i) => ({ s, i })).filter((x) => x.s === 'current' || x.s === 'blocked')
  const allDone = states.every((s) => s === 'done')
  if (allDone) {
    if (active.length) fail(`${ctx}: a fully-done case still marks an active node`)
  } else if (active.length !== 1) {
    fail(`${ctx}: expected exactly 1 current/blocked node, got ${active.length} — ${states.join(',')}`)
  } else if (active[0].i !== firstNotDone) {
    fail(`${ctx}: active node is #${active[0].i}, but the first incomplete stage is #${firstNotDone}`)
  }

  // 3. Counter and legend.
  const doneCount = states.filter((s) => s === 'done').length
  if (tl.count !== `${doneCount} of 5 stages complete`) {
    fail(`${ctx}: counter reads "${tl.count}" but ${doneCount} node(s) are Done`)
  }
  if (tl.legend.join('|') !== 'Done|Current|Pending') fail(`${ctx}: legend reads ${JSON.stringify(tl.legend)}`)

  // 4. Fill stops at the last completed dot (not beyond, not at full width).
  const lastDone = states.lastIndexOf('done')
  const expectedRight = lastDone <= 0 ? tl.rootLeft : tl.nodes[lastDone].dotCentre
  const slack = 12
  if (lastDone <= 0) {
    if (tl.fillWidth > slack) fail(`${ctx}: nothing/only-first done but the fill is ${tl.fillWidth.toFixed(0)}px wide`)
  } else if (Math.abs(tl.fillRight - expectedRight) > slack) {
    fail(`${ctx}: fill ends at ${tl.fillRight.toFixed(0)}px, last Done dot is at ${expectedRight.toFixed(0)}px`)
  }
  if (!allDone && tl.fillRight > tl.nodes[4].dotCentre - slack) {
    fail(`${ctx}: fill reaches the last dot on a case that isn't complete`)
  }

  // 5. Per-state presentation.
  for (const n of tl.nodes) {
    if (n.state === 'done' && !n.hasCheck) fail(`${ctx}: Done node "${n.label}" has no check icon`)
    if (n.state !== 'done' && n.hasCheck) fail(`${ctx}: non-Done node "${n.label}" shows a check icon`)
    if (n.state === 'current') {
      if (n.date !== 'In progress') fail(`${ctx}: current node "${n.label}" reads "${n.date}", expected "In progress"`)
      if (n.ring === 'none') fail(`${ctx}: current node "${n.label}" has no ring`)
    }
    if (n.state === 'pending' && n.date !== 'Pending') {
      fail(`${ctx}: pending node "${n.label}" reads "${n.date}", expected "Pending"`)
    }
    if (n.state === 'blocked' && n.date !== 'Blocked') {
      fail(`${ctx}: blocked node "${n.label}" reads "${n.date}", expected "Blocked"`)
    }
  }

  // 6. Dates are chronological, and only real dates are dates.
  const DATE_RE = /^\d{2} [A-Za-z]{3,4}$/
  const dated = tl.nodes.map((n, i) => ({ i, label: n.label, date: n.date })).filter((d) => DATE_RE.test(d.date))
  const parsed = dated.map((d) => ({ ...d, t: new Date(`${d.date} 2026`).getTime() }))
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].t < parsed[i - 1].t) {
      fail(`${ctx}: dates out of order — ${parsed[i - 1].label} ${parsed[i - 1].date} then ${parsed[i].label} ${parsed[i].date}`)
    }
  }
  for (const d of dated) {
    if (d.label !== 'Relieving') fail(`${ctx}: "${d.label}" shows a bare date (${d.date}) with no recorded completion time`)
    if (tl.nodes[d.i].state !== 'done') fail(`${ctx}: "${d.label}" shows a date while not Done`)
  }

  // 7. Every Done stage node is backed by the database.
  if (caseId) {
    const { data: tasks } = await db.from('exit_tasks').select('stage,status,title').eq('case_id', caseId)
    for (const n of tl.nodes) {
      const stage = LABEL_TO_STAGE[n.label]
      if (!stage) continue
      const work = (tasks ?? []).filter((t) => t.stage === stage && !t.title?.startsWith('Escalated'))
      const reallyDone = work.length > 0 && work.every((t) => t.status === 'done')
      if (n.state === 'done' && !reallyDone) fail(`${ctx}: "${n.label}" renders Done but its tasks are not all done`)
      if (n.state !== 'done' && reallyDone && STAGE_KEYS.indexOf(stage) < firstNotDone) {
        fail(`${ctx}: "${n.label}" is complete and unblocked but does not render Done`)
      }
    }
  }
  return { states, labels, doneCount }
}

const caseFor = async (empId) =>
  (await db.from('exit_cases').select('*').eq('employee_id', empId).maybeSingle()).data

async function checkEmployee(page, acct, ctx, shot) {
  const kase = await caseFor(acct.empId)
  await logout(page)
  await login(page, acct)
  await page.goto(`${BASE}/employee/timeline`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const tl = await readTimeline(page)
  if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false })
  return { result: await assertTimeline(tl, ctx, kase?.id), tl, kase }
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  try {
    console.log('\n--- fully-complete case ---')
    const done = await checkEmployee(page, DONE_CASE, `${DONE_CASE.empId} (complete)`, 'timeline_complete.png')
    if (done.result) {
      if (done.result.doneCount !== 5) fail(`${DONE_CASE.empId}: expected 5 of 5 done, got ${done.result.doneCount}`)
      const rel = done.tl.nodes[4]
      const expected = fmtDate(done.kase.issued_at)
      if (rel.date !== expected) fail(`${DONE_CASE.empId}: Relieving reads "${rel.date}", issued_at is "${expected}"`)
      else log(`  Relieving shows the real issued_at: ${expected}`)
    }

    console.log('\n--- mid-pipeline cases ---')
    for (const m of MID_CASES) {
      const r = await checkEmployee(page, m, `${m.empId} (mid)`, `timeline_mid_${m.empId}.png`)
      if (r.result) {
        const cur = r.result.states.indexOf('current')
        if (cur === -1) fail(`${m.empId}: mid-pipeline case shows no current stage`)
        else log(`  current stage is "${r.result.labels[cur]}" (${r.result.doneCount} of 5 done)`)
        if (r.result.doneCount === 5) fail(`${m.empId}: mid-pipeline case shows all 5 done`)
      }
    }

    console.log('\n--- dashboard render site (same component) ---')
    await page.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const dash = await readTimeline(page)
    const dashKase = await caseFor(MID_CASES[1].empId)
    await assertTimeline(dash, `${MID_CASES[1].empId} (dashboard)`, dashKase?.id)

    console.log('\n--- blocked case (disposable) ---')
    await purge(BLOCKED.empId)
    await logout(page)
    await login(page, { ...BLOCKED, url: /\/employee/ })
    let built = null
    for (let attempt = 1; attempt <= 3 && !built; attempt++) {
      await page.goto(`${BASE}/employee`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      if (!(await page.locator('#resign-last-day').count())) { await purge(BLOCKED.empId); continue }
      await page.fill('#resign-last-day', BLOCKED.lastDay)
      await page.fill('#resign-reason', 'Disposable verification case — timeline blocked state.')
      await page.click('button.login-submit')
      await page.waitForTimeout(3000)
      const k = await poll('blocked-case row', async () => await caseFor(BLOCKED.empId), 60000, true)
      if (k) {
        const ok = await poll('blocked-case checklist', async () => {
          const { data } = await db.from('exit_tasks').select('stage').eq('case_id', k.id)
          return (data ?? []).some((t) => t.stage === 'manager') ? true : null
        }, 90000, true)
        if (ok) built = k
      }
      if (!built) await purge(BLOCKED.empId)
    }
    if (!built) fail('blocked case: resignation never produced a checklist')
    else {
      // HR done first, so the manager stage is the one the case sits on.
      await page.goto(`${BASE}/employee/tasks`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000)
      for (let i = 0; i < 12; i++) {
        const btn = page.locator('button.mark-done').first()
        if (!(await btn.count())) break
        await btn.click()
        await page.waitForTimeout(1000)
      }
      await logout(page)
      await login(page, MANAGER)
      await page.goto(`${BASE}/manager/kt-approvals`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      page.once('dialog', (d) => d.accept('Verification run — handover incomplete.'))
      const clicked = await page.evaluate((name) => {
        const headers = [...document.querySelectorAll('[data-group-header="true"]')]
        const h = headers.find((x) => x.textContent.includes(name))
        if (!h) return false
        let n = h.nextElementSibling
        while (n && !n.hasAttribute('data-group-header')) {
          const b = [...n.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Reject' && !x.disabled)
          if (b) { b.click(); return true }
          n = n.nextElementSibling
        }
        return false
      }, built.employee_name)
      if (!clicked) fail('blocked case: manager Reject button not found')
      await page.waitForTimeout(3500)
      const esc = await poll('escalation row', async () => {
        const { data } = await db.from('exit_tasks').select('escalation_state').eq('case_id', built.id).ilike('title', 'Escalated%')
        return (data ?? []).some((e) => e.escalation_state === 'open') ? true : null
      }, 45000)
      if (esc) {
        const r = await checkEmployee(page, BLOCKED, `${BLOCKED.empId} (blocked)`, 'timeline_blocked.png')
        if (r.result) {
          const bi = r.result.states.indexOf('blocked')
          if (bi === -1) fail(`${BLOCKED.empId}: open escalation but no blocked node`)
          else {
            log(`  blocked at "${r.result.labels[bi]}" — later stages: ${r.result.states.slice(bi + 1).join(',')}`)
            if (r.result.states.slice(bi).includes('done')) fail(`${BLOCKED.empId}: a stage at/after the block renders Done`)
          }
        }
      }
    }
  } catch (e) {
    fail(`threw: ${e.message}`)
  } finally {
    if (errors.length) fail(`console errors: ${errors.slice(0, 2).join(' | ').slice(0, 220)}`)
    await browser.close()
    await purge(BLOCKED.empId)
    const left = await caseFor(BLOCKED.empId)
    console.log(left ? `\ncleanup: ${BLOCKED.empId} STILL has a case` : `\ncleanup: ${BLOCKED.empId} restored to no-exit-case`)
    if (left) failures.push('cleanup incomplete')
  }

  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

run().catch((e) => { console.error(e); process.exit(1) })
