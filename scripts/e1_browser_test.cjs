// One-off E1 real-browser end-to-end check. Not part of the app; run once,
// then delete. See blueprint1.md E1.
const { chromium } = require('playwright')

const BASE = 'http://localhost:5173'
const EMP_NAME = 'Mason Sharma'
const OUT = 'scripts/e1_screens'

const accounts = {
  employee: { email: 'emp009@gmail.com', password: 'Emp009@' },
  manager: { email: 'aravidhan@gmail.com', password: 'aravidhan@' },
  it: { email: 'aswin@gmail.com', password: 'aswin@' },
  hr: { email: 'siva@gmail.com', password: 'siva@1' },
}

async function login(page, { email, password }) {
  await page.goto(BASE)
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/(employee|manager|it|hr)/, { timeout: 15000 })
}

function consoleErrors(page) {
  const errs = []
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()) })
  page.on('pageerror', (err) => errs.push(String(err)))
  return errs
}

async function run() {
  const fs = require('fs')
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const results = {}

  // Manager: approve the KT review for our case
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.manager)
    await page.goto(`${BASE}/manager/kt-approvals`)
    await page.waitForSelector(`text=${EMP_NAME}`, { timeout: 10000 })
    const row = page.locator(`*:has-text("${EMP_NAME}")`).last()
    await page.screenshot({ path: `${OUT}/manager_before.png`, fullPage: true })
    const btn = page.getByRole('button', { name: 'Review' }).first()
    await btn.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/manager_after.png`, fullPage: true })
    results.manager = { consoleErrors: errs.slice() }
    await page.close()
  }

  // IT: approve every deprovisioning task for our case
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.it)
    await page.goto(`${BASE}/it/deprovisioning`)
    await page.waitForSelector(`text=${EMP_NAME}`, { timeout: 10000 })
    await page.screenshot({ path: `${OUT}/it_before.png`, fullPage: true })
    let clicked = 0
    for (let i = 0; i < 10; i++) {
      const btn = page.getByRole('button', { name: 'Approve' }).first()
      if (await btn.count() === 0) break
      await btn.click()
      clicked++
      await page.waitForTimeout(800)
    }
    await page.screenshot({ path: `${OUT}/it_after.png`, fullPage: true })
    results.it = { consoleErrors: errs.slice(), approved: clicked }
    await page.close()
  }

  // Employee: dashboard loads + Ask assistant works
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.employee)
    await page.waitForSelector('text=Good morning', { timeout: 10000 }).catch(() => {})
    await page.screenshot({ path: `${OUT}/employee_dashboard.png`, fullPage: true })
    await page.fill('input.ask-input', 'When do I get my final settlement?')
    await page.getByRole('button', { name: /Ask/ }).click()
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${OUT}/employee_ask.png`, fullPage: true })
    results.employee = { consoleErrors: errs.slice() }
    await page.close()
  }

  // HR: dashboard shows this case with risk populated
  {
    const page = await browser.newPage()
    const errs = consoleErrors(page)
    await login(page, accounts.hr)
    await page.waitForSelector(`text=${EMP_NAME}`, { timeout: 10000 })
    const bodyText = await page.textContent('body')
    await page.screenshot({ path: `${OUT}/hr_dashboard.png`, fullPage: true })
    results.hr = { consoleErrors: errs.slice(), caseVisible: bodyText.includes(EMP_NAME) }
    await page.close()
  }

  await browser.close()
  console.log(JSON.stringify(results, null, 2))
}

run().catch((e) => { console.error('FAIL:', e); process.exit(1) })
