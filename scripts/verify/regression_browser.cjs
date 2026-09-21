// REGRESSION 1-6 — five role logins + RAG, in a real browser. READ ONLY:
// no action button is clicked on any seeded case.
const { chromium } = require('playwright')

const ROLES = [
  ['Employee (Emp022)', 'emp022@gmail.com', 'Emp022@', '/employee'],
  ['HR (Siva)', 'siva@company.com', 'siva@1', '/hr'],
  ['Manager (Aravidhan)', 'aravidhan@company.com', 'aravidhan@', '/manager'],
  ['IT (Aswin)', 'aswin@gmail.com', 'aswin@', '/it'],
  ['Finance (Anfia)', 'anfiacj@gmail.com', 'anfiacj@', '/finance'],
]

;(async () => {
  const browser = await chromium.launch()
  let pass = 0
  const results = []

  for (const [label, email, pw, expect] of ROLES) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 140)))
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 140)))
    try {
      await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
      await page.fill('#login-email', email)
      await page.fill('#login-password', pw)
      await page.click('button.login-submit')
      await page.waitForURL((u) => new URL(u).pathname.startsWith(expect), { timeout: 20000 })
      await page.waitForTimeout(2500)
      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      const ok = new URL(page.url()).pathname.startsWith(expect) && body.length > 120 && errs.length === 0
      if (ok) pass++
      results.push(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(22)} -> ${new URL(page.url()).pathname.padEnd(11)} chars=${String(body.length).padStart(5)} consoleErrs=${errs.length}`)
      if (errs.length) results.push('        ' + errs.slice(0, 2).join(' | '))
      await page.screenshot({ path: `scripts/_review/shots/reg_${expect.slice(1)}.png`, fullPage: false })
    } catch (e) {
      results.push(`FAIL  ${label.padEnd(22)} -> ${String(e).slice(0, 110)}`)
    }
    await ctx.close()
  }

  // --- 6. RAG, through the employee UI -------------------------------------
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  let ragPass = 0
  try {
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await page.fill('#login-email', 'emp022@gmail.com')
    await page.fill('#login-password', 'Emp022@')
    await page.click('button.login-submit')
    await page.waitForURL((u) => new URL(u).pathname.startsWith('/employee'), { timeout: 20000 })
    await page.waitForTimeout(2000)

    const answers = await page.evaluate(async () => {
      const out = []
      for (const q of ['What is the notice period?', 'What is a good pasta recipe?']) {
        const r = await fetch(
          `${window.location.origin.replace(/:\d+$/, '')}`, // placeholder, replaced below
        ).catch(() => null)
        out.push(q)
      }
      return out
    }).catch(() => null)

    // Invoke the edge function through the page's own supabase session instead
    const res = await page.evaluate(async () => {
      const mod = await import('/src/lib/supabase.js')
      const ask = async (question) => {
        const { data, error } = await mod.supabase.functions.invoke('ask', { body: { question } })
        return error ? { error: String(error) } : data
      }
      const t0 = performance.now()
      const policy = await ask('What is the notice period I have to serve?')
      const t1 = performance.now()
      const off = await ask('What is a good recipe for pasta carbonara?')
      const t2 = performance.now()
      return { policy, off, msPolicy: Math.round(t1 - t0), msOff: Math.round(t2 - t1) }
    })

    const p = res.policy || {}
    const o = res.off || {}
    const pOk = !p.error && !p.refused && Array.isArray(p.sources) && p.sources.length > 0
    const oOk = !o.error && o.refused === true && (o.sources || []).length === 0
    if (pOk) ragPass++
    if (oOk) ragPass++
    results.push(`${pOk ? 'PASS' : 'FAIL'}  RAG in-policy          -> refused=${p.refused} sources=${(p.sources || []).length} ${res.msPolicy}ms`)
    results.push(`        cites: ${JSON.stringify((p.sources || []).map((s) => s.section))}`)
    results.push(`        answer: ${String(p.answer || p.error).slice(0, 130)}`)
    results.push(`${oOk ? 'PASS' : 'FAIL'}  RAG off-topic refusal  -> refused=${o.refused} sources=${(o.sources || []).length} ${res.msOff}ms`)
    results.push(`        answer: ${String(o.answer || o.error).slice(0, 110)}`)
  } catch (e) {
    results.push('FAIL  RAG -> ' + String(e).slice(0, 160))
  }
  await ctx.close()
  await browser.close()

  console.log(results.join('\n'))
  console.log(`\nlogins ${pass}/5, rag ${ragPass}/2`)
})()
