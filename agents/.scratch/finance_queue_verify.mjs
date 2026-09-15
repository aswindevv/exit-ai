// Scoped verify: Finance clearance queue is one row per case, ordered
// Ready -> Blocked -> Settled, with correct actions and matching KPIs.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'anfiacj@gmail.com')
await page.fill('input[type="password"]', 'anfiacj@')
await page.click('button[type="submit"]')
await page.waitForURL(/\/finance/, { timeout: 15000 })
await page.waitForSelector('.card .row', { timeout: 15000 })

const kpis = await page.$$eval('.kpi', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()))
console.log('KPIS:', kpis)

const rows = await page.$$eval('.card .list > .row', (els) =>
  els.map((el) => {
    const spans = el.querySelectorAll(':scope > span')
    return {
      name: spans[0]?.textContent?.trim(),
      dept: spans[1]?.textContent?.trim(),
      lastDay: spans[2]?.textContent?.trim(),
      status: spans[3]?.textContent?.trim(),
      hasSettleBtn: !!el.querySelector('button'),
      actionText: spans[4]?.textContent?.trim(),
      opacity: getComputedStyle(el).opacity,
    }
  })
)
console.log('ROWS:', JSON.stringify(rows, null, 2))

// One row per case (no separate header row) -- 5 leaf spans per row.
const caseCountRes = await page.$$eval('.card .list > .row', (els) => els.length)
const dbCaseCount = 25 // from prior SQL: 25 exit_cases total
if (caseCountRes !== dbCaseCount) errors.push(`Expected ${dbCaseCount} rows (one per case), got ${caseCountRes}`)

function tierOf(status) {
  if (/Blocked/i.test(status)) return 1
  if (/Signed/i.test(status)) return 2
  return 0 // Pending/Held == ready tier
}
let maxTierSeen = -1
for (const r of rows) {
  const t = tierOf(r.status)
  if (t < maxTierSeen) errors.push(`Order violation: "${r.name}" (${r.status}) appears after a later tier`)
  maxTierSeen = Math.max(maxTierSeen, t)
}

// Ready rows must have a working Settle button; Blocked/Settled rows must not.
for (const r of rows) {
  const isReady = /Pending|Held/i.test(r.status) && !/Blocked/i.test(r.status)
  if (isReady && !r.hasSettleBtn) errors.push(`Ready row "${r.name}" has no Settle button`)
  if (!isReady && r.hasSettleBtn) errors.push(`Non-ready row "${r.name}" (${r.status}) unexpectedly has a button`)
  if (/Blocked/i.test(r.status) && r.actionText !== '—') errors.push(`Blocked row "${r.name}" action should be "—", got "${r.actionText}"`)
  if (/Signed/i.test(r.status) && r.actionText !== 'Done') errors.push(`Settled row "${r.name}" action should be "Done", got "${r.actionText}"`)
  if (/Blocked/i.test(r.status) && !r.status.includes('·')) errors.push(`Blocked row "${r.name}" missing a short reason`)
}

// Settled rows must render visibly dimmed (opacity 0.55 per the fix).
for (const r of rows) {
  if (/Signed/i.test(r.status) && Number(r.opacity) >= 1) errors.push(`Settled row "${r.name}" is not dimmed (opacity=${r.opacity})`)
  if (!/Signed/i.test(r.status) && Number(r.opacity) < 1) errors.push(`Non-settled row "${r.name}" unexpectedly dimmed (opacity=${r.opacity})`)
}

// KPI counts must match real tier counts from the rendered rows.
const readyN = rows.filter((r) => tierOf(r.status) === 0).length
const blockedN = rows.filter((r) => tierOf(r.status) === 1).length
const settledN = rows.filter((r) => tierOf(r.status) === 2).length
const kpiText = kpis.join(' | ')
if (!kpiText.includes(`Ready ${readyN}`)) errors.push(`KPI Ready mismatch: expected ${readyN} in "${kpiText}"`)
if (!kpiText.includes(`Blocked ${blockedN}`)) errors.push(`KPI Blocked mismatch: expected ${blockedN} in "${kpiText}"`)
if (!kpiText.includes(`Settled ${settledN}`)) errors.push(`KPI Settled mismatch: expected ${settledN} in "${kpiText}"`)

if (readyN === 0) {
  console.log('NOTE: no real case is currently in Ready/Held state (all 25 seeded cases are either blocked on a prior stage or already settled) -- Settle-button-on-Ready path verified by conditional logic only (every non-ready row correctly has no button), not by a live click.')
}

await browser.close()

if (errors.length) {
  console.log('FAIL')
  for (const e of errors) console.log(' -', e)
  process.exit(1)
} else {
  console.log('PASS')
}
