// Task D employee-role e2e verification for a FRESH employee (Emp018 / Diya
// Patel, no exit_cases row yet). Mirrors scripts/e1_browser_test.cjs's
// login/selector conventions. Scoped locators only.
const { chromium } = require('playwright')

const BASE = 'http://localhost:5173'
const OUT = 'scripts/taskd_screens'
const account = { email: 'emp018@gmail.com', password: 'Emp018@' }

async function login(page) {
  await page.goto(BASE)
  await page.fill('#login-email', account.email)
  await page.fill('#login-password', account.password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/employee/, { timeout: 15000 })
}

function consoleErrors(page) {
  const errs = []
  page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()) })
  page.on('pageerror', (err) => errs.push(String(err)))
  return errs
}

;(async () => {
  const fs = require('fs')
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errs = consoleErrors(page)

  console.log('--- STEP 1: login ---')
  await login(page)
  console.log('URL after login:', page.url())
  await page.screenshot({ path: `${OUT}/01_after_login.png`, fullPage: true })

  // Step 2: resignation form (fresh employee is redirected here by EmployeeLayout guard)
  console.log('--- STEP 2: submit resignation ---')
  await page.waitForSelector('#resign-last-day', { timeout: 10000 })
  const lastDay = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  await page.fill('#resign-last-day', lastDay)
  await page.fill('#resign-reason', 'Task D Playwright verification — pursuing a new opportunity.')
  await page.screenshot({ path: `${OUT}/02_resignation_form.png`, fullPage: true })
  await page.locator('form button.login-submit').click()
  await page.waitForURL(/\/employee$/, { timeout: 20000 })
  await page.waitForTimeout(2000) // let the non-fatal :8787/activate-exit call settle
  console.log('URL after resignation submit:', page.url())
  await page.screenshot({ path: `${OUT}/03_dashboard_after_resignation.png`, fullPage: true })

  // Step 3 is covered by the same dashboard screenshot (checklist/timeline visible there).

  // Step 4: Ask chatbot
  console.log('--- STEP 4: Ask chatbot ---')
  const askInput = page.locator('input.ask-input')
  await askInput.waitFor({ timeout: 10000 })
  await askInput.fill('What are the steps in my offboarding checklist and when is my last day?')
  await page.getByRole('button', { name: /Ask/ }).click()
  await page.waitForTimeout(6000) // RAG edge function round trip
  await page.screenshot({ path: `${OUT}/04_ask_result.png`, fullPage: true })
  const askResultText = await page.locator('body').innerText()
  const askSnippetMatch = askResultText.match(/[\s\S]{0,400}(Sources?|refused|answer)[\s\S]{0,400}/i)
  console.log('ASK_PAGE_TEXT_AROUND_RESULT:', askSnippetMatch ? askSnippetMatch[0] : '(marker not found)')

  // Step 5: exit interview
  console.log('--- STEP 5: submit exit interview ---')
  await page.goto(`${BASE}/employee/exit-interview`)
  await page.waitForSelector('#ei-reason', { timeout: 10000 })
  await page.fill('#ei-reason', 'Better growth opportunity elsewhere')
  await page.fill('#ei-feedback', 'Overall a positive experience, management was supportive and the team collaborated well. Onboarding could have been faster.')
  await page.selectOption('#ei-recommend', 'yes')
  await page.fill('#ei-comments', 'Would love more clarity on career progression paths for the next hire in my role.')
  await page.screenshot({ path: `${OUT}/05_exit_interview_form.png`, fullPage: true })
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.waitForTimeout(4000) // non-fatal :8787/submit-exit-interview + agent write
  await page.screenshot({ path: `${OUT}/06_exit_interview_after_submit.png`, fullPage: true })

  // Step 6: timeline
  console.log('--- STEP 6: timeline ---')
  await page.goto(`${BASE}/employee/timeline`)
  await page.waitForSelector('.tl-node', { timeout: 10000 })
  await page.screenshot({ path: `${OUT}/07_timeline.png`, fullPage: true })
  const nodes = await page.locator('.tl-node').allInnerTexts()
  console.log('TIMELINE_NODES:', JSON.stringify(nodes))

  // Step 7: access-control — capture the employee_exit_view network response verbatim
  console.log('--- STEP 7: access-control network capture ---')
  let viewPayload = null
  page.on('response', async (res) => {
    if (res.url().includes('employee_exit_view')) {
      try { viewPayload = await res.json() } catch { /* non-JSON, ignore */ }
    }
  })
  await page.goto(`${BASE}/employee`)
  await page.waitForTimeout(3000)
  console.log('EMPLOYEE_EXIT_VIEW_PAYLOAD:', JSON.stringify(viewPayload))
  await page.screenshot({ path: `${OUT}/08_dashboard_final.png`, fullPage: true })

  console.log('--- CONSOLE ERRORS ---', JSON.stringify(errs))

  await browser.close()
})().catch((e) => { console.error('SCRIPT_FAILED:', e); process.exit(1) })
