// One-off Task-D Part B check: does Emp017/Ethan Patel's employee timeline
// reflect real case state when a manager-stage task is approved? Run once,
// then delete.
const { chromium } = require('playwright')

const BASE = 'http://localhost:5173'
const OUT = 'scripts/d_screens'
const KT_TITLE = 'Schedule knowledge transfer session with team'

const accounts = {
  employee: { email: 'emp017@gmail.com', password: 'Emp017@' },
  manager: { email: 'aravidhan@company.com', password: 'aravidhan@' },
}

async function login(page, { email, password }) {
  await page.goto(BASE)
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/(employee|manager|it|hr|finance)/, { timeout: 15000 })
}

async function readTimeline(page) {
  await page.waitForSelector('.timeline', { timeout: 10000 })
  return page.$$eval('.tl-node', (nodes) =>
    nodes.map((n) => ({
      label: n.querySelector('.tl-label')?.textContent?.trim(),
      date: n.querySelector('.tl-date')?.textContent?.trim(),
      open: !!n.querySelector('.tl-dot--open'),
    }))
  )
}

async function run() {
  const fs = require('fs')
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const out = {}

  const empPage = await browser.newPage()
  await login(empPage, accounts.employee)
  out.before = await readTimeline(empPage)
  await empPage.screenshot({ path: `${OUT}/emp017_before.png`, fullPage: true })

  const mgrPage = await browser.newPage()
  await login(mgrPage, accounts.manager)
  await mgrPage.goto(`${BASE}/manager/kt-approvals`)
  const row = mgrPage.locator('div.row', { hasText: `${KT_TITLE} · ` })
  await row.waitFor({ timeout: 10000 })
  await mgrPage.screenshot({ path: `${OUT}/manager_before.png`, fullPage: true })
  await row.getByRole('button', { name: 'Review' }).click()
  await mgrPage.waitForTimeout(1500)
  out.managerRowAfterText = await row.textContent()
  await mgrPage.screenshot({ path: `${OUT}/manager_after.png`, fullPage: true })

  await empPage.reload()
  out.after = await readTimeline(empPage)
  await empPage.screenshot({ path: `${OUT}/emp017_after.png`, fullPage: true })

  await browser.close()
  console.log(JSON.stringify(out, null, 2))
}

run().catch((e) => { console.error('FAIL:', e); process.exit(1) })
