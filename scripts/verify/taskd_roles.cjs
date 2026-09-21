// Task D role verification: HR, Manager, IT, Finance + cross-role nav confinement.
// Follows scripts/e1_browser_test.cjs's convention. Fixtures pre-selected via DB
// queries (see fork report) to avoid Emp017/18/19/20 (reserved by other forks).
const { chromium } = require('playwright')
const path = require('path')

const BASE = 'http://localhost:5173'
const SCREENS = path.join(__dirname, '..', '..', 'taskd_screens')

const accounts = {
  hr: { email: 'siva@company.com', password: 'siva@1' },
  manager: { email: 'aravidhan@company.com', password: 'aravidhan@' },
  it: { email: 'aswin@gmail.com', password: 'aswin@' },
  finance: { email: 'anfiacj@gmail.com', password: 'anfiacj@' },
}

async function login(page, { email, password }) {
  await page.goto(BASE)
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/(employee|manager|it|hr|finance)/, { timeout: 15000 })
}

function consoleErrors(page) {
  const errs = []
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()) })
  page.on('pageerror', (err) => errs.push(String(err)))
  return errs
}

async function logout(page) {
  await page.click('.logout-btn')
  await page.waitForURL(/\/login|\/$/, { timeout: 10000 }).catch(() => {})
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const results = {}

  // ---------------- HR (Siva) ----------------
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.hr)
    await page.screenshot({ path: path.join(SCREENS, 'hr_dashboard.png'), fullPage: true })
    const navText = await page.locator('.sidebar .nav').innerText()

    await page.goto(`${BASE}/hr/risk-and-compliance`)
    await page.waitForSelector('.card-title')
    await page.screenshot({ path: path.join(SCREENS, 'hr_risk_compliance.png'), fullPage: true })
    const riskRowText = await page.locator('.list .row').first().innerText()

    await page.goto(`${BASE}/hr/exit-interviews`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SCREENS, 'hr_exit_interviews.png'), fullPage: true })
    const interviewsText = await page.locator('body').innerText()

    await page.goto(`${BASE}/hr/trends`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SCREENS, 'hr_trends.png'), fullPage: true })
    const trendsText = await page.locator('body').innerText()

    await page.goto(`${BASE}/hr/reports`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SCREENS, 'hr_reports.png'), fullPage: true })
    const reportsText = await page.locator('body').innerText()

    // Issue relieving letter for Emp006 Ananya Sharma (naturally-ready, not reserved).
    await page.goto(`${BASE}/hr/clearances`)
    await page.waitForSelector('.card-title')
    const ananyaRow = page.locator('.row:has-text("Ananya Sharma")').last()
    let issueClicked = false
    if (await ananyaRow.count()) {
      const btn = ananyaRow.getByRole('button', { name: 'Issue relieving letter' })
      if (await btn.count()) {
        await btn.click()
        await page.waitForTimeout(1500)
        issueClicked = true
      }
    }
    await page.screenshot({ path: path.join(SCREENS, 'hr_clearances_after_issue.png'), fullPage: true })

    await logout(page)
    results.hr = { navText, riskRowText, interviewsHasContent: interviewsText.length > 0, trendsHasContent: trendsText.length > 0, reportsHasContent: reportsText.length > 0, issueClicked, consoleErrors: errs }
    await page.close()
  }

  // ---------------- Manager (Aravidhan) ----------------
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.manager)
    await page.screenshot({ path: path.join(SCREENS, 'manager_dashboard.png'), fullPage: true })
    const navText = await page.locator('.sidebar .nav').innerText()

    // KT approval: Diya Sharma (Emp008) "Reassign active recruitment and onboarding tasks"
    await page.goto(`${BASE}/manager/kt-approvals`)
    await page.waitForSelector('.card-title')
    const ktRow = page.locator('.row:has-text("Reassign active recruitment and onboarding tasks")').last()
    let ktApproved = false
    if (await ktRow.count()) {
      const btn = ktRow.getByRole('button', { name: 'Review' })
      if (await btn.count()) {
        await btn.click()
        await page.waitForTimeout(1500)
        ktApproved = true
      }
    }
    await page.screenshot({ path: path.join(SCREENS, 'manager_kt_after.png'), fullPage: true })

    // Clearance sign: Diya Sharma (Emp008) "Clear final settlement dues".
    // Many employees share that exact task title, so scope via the group
    // header (employee name) -> its immediate next-sibling row (that
    // employee's one finance-stage task row), not a page-wide text match.
    await page.goto(`${BASE}/manager/clearances`)
    await page.waitForSelector('.card-title')
    const diyaHeader = page.locator('[data-group-header="true"]:has-text("Diya Sharma")')
    let signed = false
    if (await diyaHeader.count()) {
      const diyaTaskRow = diyaHeader.locator('xpath=following-sibling::div[1]')
      const btn = diyaTaskRow.getByRole('button', { name: 'Sign' })
      if (await btn.count()) {
        await btn.click()
        await page.waitForTimeout(1500)
        signed = true
      }
    }
    await page.screenshot({ path: path.join(SCREENS, 'manager_clearances_after.png'), fullPage: true })

    await logout(page)
    results.manager = { navText, ktApproved, signed, consoleErrors: errs }
    await page.close()
  }

  // ---------------- IT (Aswin) ----------------
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.it)
    await page.screenshot({ path: path.join(SCREENS, 'it_dashboard.png'), fullPage: true })
    const navText = await page.locator('.sidebar .nav').innerText()

    // Deprovisioning approve: Ishaan Sharma (Emp010) "Collect company laptop".
    // Exact-text match (not substring) -- Priya Patel has a similarly-worded
    // "Collect company laptop and peripherals" task that a substring match
    // would wrongly prefer via .last().
    await page.goto(`${BASE}/it/deprovisioning`)
    await page.waitForSelector('.card-title')
    const laptopTitle = page.getByText('Collect company laptop', { exact: true })
    let approved = false
    if (await laptopTitle.count()) {
      const laptopRow = laptopTitle.locator('xpath=ancestor::div[contains(@class,"row")][1]')
      const btn = laptopRow.getByRole('button', { name: 'Approve' })
      if (await btn.count()) {
        await btn.click()
        await page.waitForTimeout(1500)
        approved = true
      }
    }
    await page.screenshot({ path: path.join(SCREENS, 'it_deprovisioning_after.png'), fullPage: true })

    await logout(page)
    results.it = { navText, approved, consoleErrors: errs }
    await page.close()
  }

  // ---------------- Finance (Anfia) ----------------
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.finance)
    await page.screenshot({ path: path.join(SCREENS, 'finance_dashboard_before.png'), fullPage: true })
    const navText = await page.locator('.sidebar .nav').innerText()

    // Mark dues settled: Liam Sharma (Emp003), the only naturally "ready" case.
    // Wait for the async case/task fetch to render before querying the list.
    await page.waitForSelector('.card-title')
    await page.waitForFunction(() => document.body.innerText.includes('Liam Sharma'), { timeout: 10000 }).catch(() => {})
    const liamHeader = page.locator('[data-group-header="true"]:has-text("Liam Sharma")')
    let settled = false
    if (await liamHeader.count()) {
      const liamTaskRow = liamHeader.locator('xpath=following-sibling::div[1]')
      const btn = liamTaskRow.getByRole('button', { name: 'Mark dues settled' })
      if (await btn.count()) {
        await btn.click()
        await page.waitForTimeout(1500)
        settled = true
      }
    }
    await page.screenshot({ path: path.join(SCREENS, 'finance_dashboard_after.png'), fullPage: true })

    await logout(page)
    results.finance = { navText, settled, consoleErrors: errs }
    await page.close()
  }

  await browser.close()
  console.log(JSON.stringify(results, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
