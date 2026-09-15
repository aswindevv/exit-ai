// Employee audit pass 3: exercises Mark-done (Tasks), document upload
// (Documents), and exit-interview submission (valid + invalid) against
// Emp050's now-real disposable case created in pass 2.
import { chromium } from 'playwright'
import path from 'path'

const BASE = 'http://localhost:5173'
const results = { consoleErrors: [], networkFailures: [], networkCalls: [] }

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', (msg) => { if (msg.type() === 'error') results.consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => results.consoleErrors.push('pageerror: ' + err.message))
page.on('response', async (res) => {
  const url = res.url()
  if (url.includes('validate-document') || url.includes('submit-exit-interview') || url.includes('storage/v1/object') || url.includes('case_documents') || url.includes('exit_interviews') || url.includes('exit_tasks')) {
    results.networkCalls.push({ url, status: res.status() })
  }
  if (res.status() >= 400) results.networkFailures.push(`${res.status()} ${res.request().method()} ${url}`)
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#login-email', 'emp050@gmail.com')
await page.fill('#login-password', 'Emp050@')
await page.click('.login-submit')
await page.waitForURL(/\/employee\/?$/, { timeout: 10000 })

// --- Tasks: Mark done ---
await page.goto(`${BASE}/employee/tasks`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
const markDoneBtn = page.locator('button.mark-done').first()
results.markDoneButtonCount = await page.locator('button.mark-done').count()
const taskRowBefore = await markDoneBtn.locator('xpath=..').innerText()
await markDoneBtn.click()
await page.waitForTimeout(1200)
results.uiUpdatedWithoutRefresh = (await page.locator('button.mark-done').count()) < results.markDoneButtonCount
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/tasks_after_mark_done.png' })

// --- Documents: upload NDA ---
await page.goto(`${BASE}/employee/documents`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
const fileInputs = page.locator('input[type=file]')
results.fileInputCount = await fileInputs.count()
const ndaPath = path.resolve('agents/.scratch/test_nda_identity.png')
await fileInputs.first().setInputFiles(ndaPath)
await page.waitForTimeout(2000)
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/documents_after_upload.png' })
const bodyAfterUpload = await page.locator('body').innerText()
results.documentsPageSnippetAfterUpload = bodyAfterUpload.slice(0, 400).replace(/\n/g, ' | ')

// --- Exit interview: invalid then valid ---
await page.goto(`${BASE}/employee/exit-interview`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
const submitBtn = page.locator('form button[type=submit]')
results.exitInterviewSubmitDisabledEmpty = await submitBtn.isDisabled()
await page.fill('#ei-reason', 'AUDIT-DISPOSABLE: automated test reason')
await page.fill('#ei-feedback', 'AUDIT-DISPOSABLE: automated feedback')
await page.selectOption('#ei-recommend', 'yes')
await page.fill('#ei-comments', 'AUDIT-DISPOSABLE: automated comments')
results.exitInterviewSubmitEnabledAfterFill = !(await submitBtn.isDisabled())
await submitBtn.click()
await page.waitForTimeout(1500)
const eiBody = await page.locator('body').innerText()
results.exitInterviewSubmittedMessageShown = eiBody.includes('has been submitted')
await page.screenshot({ path: 'agents/.scratch/e2e-audit/screenshots/employee/exit_interview_after_submit.png' })

await browser.close()
console.log(JSON.stringify(results, null, 2))
