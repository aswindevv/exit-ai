import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
const failedReqs = []
const allReqs = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
page.on('response', (r) => {
  allReqs.push(`${r.status()} ${r.url()}`)
  if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`)
})

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })

await page.goto('http://localhost:5173/it/deprovisioning', { waitUntil: 'networkidle' })

// Robustly find the exact row belonging to the disposable employee "Ishaan Gupta"
// (unique name -- real seed data only has "Ishaan Sharma") and click its Approve
// button via direct DOM traversal, not text-matching on the (colliding) task title.
const clicked = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('div'))
  const header = all.find((d) => d.textContent.trim().startsWith('Ishaan Gupta'))
  if (!header) return { found: false }
  // walk forward through siblings to find rows until the next employee header
  let el = header
  const rows = []
  while (el.nextElementSibling) {
    el = el.nextElementSibling
    const t = el.textContent || ''
    if (el.className === 'row' && el.querySelector('button')) rows.push(el.textContent)
    // stop once we've collected the SSO row and clicked it, or hit another header-like block
    if (el.querySelector('button') && /Disable SSO account access/.test(t) && /19 Sep/.test(t)) {
      const btn = el.querySelector('button')
      btn.click()
      return { found: true, matchedText: t }
    }
    if (rows.length > 8) break // safety bound
  }
  return { found: false, scanned: rows }
})
console.log('click result:', JSON.stringify(clicked))

await page.waitForTimeout(2000)
console.log('consoleErrors:', JSON.stringify(consoleErrors))
console.log('relevant reqs:', JSON.stringify(allReqs.filter(r => r.includes('8787') || r.includes('exit_tasks'))))

await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/it/after_approve_v2.png', fullPage: true })
await browser.close()
