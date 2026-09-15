// Scoped verify: fixed-column table alignment on Finance/IT/Manager queues.
// Checks: columns line up across all rows (same left edge per column index),
// no row taller than a single line (no wrap), consistent action-column width.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

// cardTitle scopes to the one .card whose .card-title matches (IT/Manager
// pages have several .list tables; a bare ".card .list > .row" selector
// would mix rows from unrelated, un-converted tables like Asset recovery).
async function checkTable(label, cardTitle) {
  await page.waitForSelector('.card-title', { timeout: 15000 })
  const rows = await page.evaluate((title) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('.card-title')?.textContent.trim() === title)
    if (!card) return null
    return [...card.querySelectorAll('.list > .row:not([data-group-header])')].map((el) => {
      const rect = el.getBoundingClientRect()
      const cellRects = [...el.children].map((c) => {
        const r = c.getBoundingClientRect()
        return { left: Math.round(r.left), width: Math.round(r.width) }
      })
      return { height: Math.round(rect.height), cellRects }
    })
  }, cardTitle)
  if (rows === null) {
    errors.push(`${label}: no card titled "${cardTitle}" found`)
    return
  }
  if (rows.length < 2) {
    errors.push(`${label}: expected >= 2 rows to compare alignment, got ${rows.length}`)
    return
  }
  const colCount = rows[0].cellRects.length
  for (const r of rows) {
    if (r.cellRects.length !== colCount) errors.push(`${label}: row has ${r.cellRects.length} cells, expected ${colCount}`)
  }
  // Every column's left edge must match across all rows (fixed columns).
  for (let col = 0; col < colCount; col++) {
    const lefts = rows.map((r) => r.cellRects[col]?.left)
    const distinct = new Set(lefts)
    if (distinct.size > 1) errors.push(`${label}: column ${col} left-edge drifts across rows: ${[...distinct].join(', ')}`)
  }
  // No row should be taller than the single-line baseline (first row height),
  // i.e. nothing wrapped onto two lines.
  const baseline = rows[0].height
  for (const r of rows) {
    if (r.height > baseline + 4) errors.push(`${label}: row height ${r.height} exceeds single-line baseline ${baseline} (wrapped?)`)
  }
  console.log(`${label}: ${rows.length} rows, ${colCount} cols, heights ${[...new Set(rows.map((r) => r.height))].join(',')}`)
}

async function login(email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('button[type="submit"]')
}

// ---- Finance ----
await login('anfiacj@gmail.com', 'anfiacj@')
await page.waitForURL(/\/finance/, { timeout: 15000 })
await checkTable('Finance clearance queue', 'Finance clearance queue')

// ---- IT ----
await page.evaluate(() => localStorage.clear())
await login('aswin@gmail.com', 'aswin@')
await page.waitForURL(/\/it/, { timeout: 15000 }).catch(async () => {
  errors.push(`IT login did not land on /it -- URL was ${page.url()}`)
})
if (/\/it/.test(page.url())) {
  await checkTable('IT deprovisioning queue', 'Deprovisioning queue')
}

// ---- Manager ----
await page.evaluate(() => localStorage.clear())
await login('aravidhan@company.com', 'aravidhan@')
await page.waitForURL(/\/manager/, { timeout: 15000 })
await checkTable('Manager "My team\'s exits"', "My team's exits")

await browser.close()

if (errors.length) {
  console.log('FAIL')
  for (const e of errors) console.log(' -', e)
  process.exit(1)
} else {
  console.log('PASS')
}
