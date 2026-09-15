// Scoped verify: employee Timeline node states must be monotonic.
// Case: Priya Sharma (Emp002) -- hr has a pending task (Complete exit interview)
// while manager/it/finance tasks are all done. Before the fix, finance/manager/it
// rendered as DONE despite hr (an earlier stage) being incomplete.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'emp002@gmail.com')
await page.fill('input[type="password"]', 'Emp002@')
await page.click('button[type="submit"]')
await page.waitForURL(/\/employee/, { timeout: 15000 })

await page.goto(`${BASE}/employee/timeline`, { waitUntil: 'networkidle' })

const nodes = await page.$$eval('.tl-node', (els) =>
  els.map((el) => ({
    label: el.querySelector('.tl-label')?.textContent?.trim(),
    date: el.querySelector('.tl-date')?.textContent?.trim(),
    state: [...el.querySelector('.tl-dot').classList],
  }))
)

console.log('TIMELINE NODES:', JSON.stringify(nodes, null, 2))

function stateOf(n) {
  if (n.state.includes('tl-dot--current')) return 'current'
  if (n.state.includes('tl-dot--blocked')) return 'blocked'
  if (n.state.includes('tl-dot--open')) return 'pending'
  return 'done'
}

const states = nodes.map(stateOf)
console.log('STATES:', states.join(' -> '))

// Monotonic check: once a non-done state appears, every later node must not be done.
let seenIncomplete = false
for (let i = 0; i < states.length; i++) {
  if (seenIncomplete && states[i] === 'done') {
    errors.push(`Non-monotonic: node[${i}] (${nodes[i].label}) is DONE after an earlier incomplete stage`)
  }
  if (states[i] !== 'done') seenIncomplete = true
}

// Expected for this exact case: hr=current (Resignation... wait label is Manager&KT etc)
// Order: Resignation(hr), Manager & KT, IT clearance, Finance clearance, Relieving
if (nodes[0]?.label !== 'Resignation') errors.push(`Unexpected node[0] label: ${nodes[0]?.label}`)
if (stateOf(nodes[0]) !== 'current') errors.push(`Expected Resignation=current (hr has a pending task), got ${stateOf(nodes[0])}`)
for (let i = 1; i < nodes.length; i++) {
  if (stateOf(nodes[i]) === 'done') errors.push(`Expected ${nodes[i].label} != done (hr not complete yet), got done`)
}

await browser.close()

if (errors.length) {
  console.log('FAIL')
  for (const e of errors) console.log(' -', e)
  process.exit(1)
} else {
  console.log('PASS')
}
