// Scoped verification for the Manager + HR Clearances fix.
// Checks: manager/hr-scope rows only (no finance settlement rows), no
// blocked/pending row rendered as "Signed", and grid columns aligned between
// the header and every row. Run with the dev server up:
//   node scripts/verify_clearances.cjs [baseUrl]
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5174'
const OUT = 'scripts/clearance_screens'

const ACCOUNTS = {
  manager: { email: 'aravidhan@company.com', password: 'aravidhan@', path: '/manager/clearances' },
  hr: { email: 'siva@company.com', password: 'siva@1', path: '/hr/clearances' },
}

const FINANCE_ROW = /clear final settlement dues/i
const SIGNED = /^signed$/i
const BLOCKED_HINT = /blocked|escalated/i

async function login(page, { email, password }) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/(employee|manager|it|hr|finance)/, { timeout: 20000 })
}

async function scrape(page) {
  return page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) =>
      /^clearances/i.test(c.querySelector('.card-title')?.textContent?.trim() || ''),
    )
    if (!card) return null
    const head = card.querySelector('.thead')
    const rows = [...card.querySelectorAll('.row')]
    return {
      headCols: head ? getComputedStyle(head).gridTemplateColumns : null,
      headText: head ? head.textContent.trim() : null,
      rows: rows.map((r) => ({
        text: r.textContent.trim(),
        cols: getComputedStyle(r).gridTemplateColumns,
        display: getComputedStyle(r).display,
        tags: [...r.querySelectorAll('.tag')].map((t) => t.textContent.trim()),
        // the "Blocked: reason" line is the row's next sibling
        reason: r.parentElement?.querySelector('.sub.c-danger')?.textContent?.trim() || null,
      })),
    }
  })
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const failures = []
  const summary = {}

  for (const [role, acct] of Object.entries(ACCOUNTS)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const consoleErrors = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await login(page, acct)
    await page.goto(BASE + acct.path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/${role}_clearances.png`, fullPage: true })

    const data = await scrape(page)
    if (!data) { failures.push(`${role}: Clearances card not found`); await page.close(); continue }

    // 1. no finance settlement rows on a manager/hr page
    const financeRows = data.rows.filter((r) => FINANCE_ROW.test(r.text))
    if (financeRows.length) failures.push(`${role}: ${financeRows.length} finance settlement row(s) still rendered`)

    // 2. nothing blocked/pending may render as "Signed"
    const wrongSigned = data.rows.filter(
      (r) => r.tags.some((t) => SIGNED.test(t)) && (BLOCKED_HINT.test(r.text) || BLOCKED_HINT.test(r.reason || '')),
    )
    if (wrongSigned.length) {
      failures.push(`${role}: ${wrongSigned.length} blocked/escalated row(s) rendered as Signed -> ${JSON.stringify(wrongSigned[0].text.slice(0, 90))}`)
    }

    // 3. every data row shares the header's grid template
    const gridRows = data.rows.filter((r) => r.display === 'grid')
    const misaligned = gridRows.filter((r) => r.cols !== data.headCols)
    if (data.headCols && misaligned.length) {
      failures.push(`${role}: ${misaligned.length} row(s) misaligned vs header (${data.headCols} vs ${misaligned[0].cols})`)
    }
    if (!data.headCols) failures.push(`${role}: Clearances table has no grid header`)

    if (consoleErrors.length) failures.push(`${role}: console errors -> ${consoleErrors[0].slice(0, 120)}`)

    summary[role] = {
      rows: data.rows.length,
      gridRows: gridRows.length,
      financeRows: financeRows.length,
      tagCounts: data.rows.flatMap((r) => r.tags).reduce((a, t) => ({ ...a, [t]: (a[t] || 0) + 1 }), {}),
      headCols: data.headCols,
      sample: data.rows.slice(0, 3).map((r) => r.text.slice(0, 80)),
      consoleErrors: consoleErrors.length,
    }
    await page.close()
  }

  await browser.close()
  console.log(JSON.stringify(summary, null, 2))
  if (failures.length) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log('  - ' + f)
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
}

run().catch((e) => { console.error(e); process.exit(1) })
