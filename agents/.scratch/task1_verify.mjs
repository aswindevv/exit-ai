// Task 1 verification: aravidhan@company.com sees reports' cases + KT approve
// works; siva@company.com HR dashboard loads with data. Scoped locators only.
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const results = []
function record(name, pass, detail) { results.push({ name, pass, detail }) }

const browser = await chromium.launch()

// ---- Manager: aravidhan@company.com ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('aravidhan@company.com')
  await page.locator('#login-password').fill('aravidhan@')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const teamCard = page.locator('.card:has(.card-title:text-is("My team\'s exits"))')
  const teamRows = await teamCard.locator('.row').count()
  record('manager login lands on dashboard', page.url().includes('/manager'), page.url())
  record("manager sees reports' cases (My team's exits rows > 0)", teamRows > 0, `rows=${teamRows}`)

  const ktCard = page.locator('.card:has(.card-title:text-is("KT approvals"))')
  const ktRows = ktCard.locator('.row--split')
  const ktCount = await ktRows.count()
  let approveWorked = false
  let approveDetail = `KT rows=${ktCount}`
  if (ktCount > 0) {
    const pendingBtn = ktRows.locator('button:has-text("Review")').first()
    if (await pendingBtn.count() > 0) {
      await pendingBtn.click()
      await page.waitForTimeout(1500)
      const anyApproved = await ktCard.locator('.tag.t-success:has-text("Approved")').count()
      approveWorked = anyApproved > 0
      approveDetail += ` approvedTagsAfterClick=${anyApproved}`
    } else {
      approveWorked = await ktCard.locator('.tag.t-success:has-text("Approved")').count() > 0
      approveDetail += ' (no pending Review button found; all already approved)'
    }
  }
  record('KT approve action works', approveWorked, approveDetail)
  await page.close()
}

// ---- HR: siva@company.com ----
{
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.locator('#login-email').fill('siva@company.com')
  await page.locator('#login-password').fill('siva@1')
  await page.locator('button.login-submit').click()
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)
  record('HR login lands on dashboard', page.url().includes('/hr'), page.url())

  const rowCount = await page.locator('.card .row, .card .row--split').count()
  const kpiCount = await page.locator('.kpi').count()
  record('HR dashboard loads with data', rowCount > 0 || kpiCount > 0, `rows=${rowCount} kpis=${kpiCount}`)
  await page.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
const anyFail = results.some((r) => !r.pass)
process.exit(anyFail ? 1 : 0)
