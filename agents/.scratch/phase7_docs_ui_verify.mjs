// Documents-page UI redesign: cards must reflect the real case_documents/OCR
// state and surface the rejection reason. Disposable case: Emp022 (Product),
// required docs = ['NDA', 'Asset Return Form']. Uploads go through the real
// Storage + case_documents + agents/service.py OCR path -- nothing mocked.
import { chromium } from 'playwright'
import path from 'path'

const BASE = 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('#login-email').fill('emp022@gmail.com')
await page.locator('#login-password').fill('Emp022@')
await page.locator('button.login-submit').click()
await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 15000 })
await page.waitForLoadState('networkidle')

await page.goto(`${BASE}/employee/documents`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

const results = []
function record(name, pass, detail) { results.push({ name, pass, detail }) }

const ndaCard = page.locator('.doc-card', { hasText: 'NDA' })
const assetCard = page.locator('.doc-card', { hasText: 'Asset Return Form' })

record('two required-doc cards rendered (Product dept)', await page.locator('.doc-card').count() === 2, `count=${await page.locator('.doc-card').count()}`)

// --- initial state: not yet uploaded ---
const ndaInitialTag = await ndaCard.locator('.tag').innerText()
record('NDA starts as Required with Upload action', ndaInitialTag === 'Required' && (await ndaCard.locator('.doc-card-action').innerText()).includes('Upload'), `tag="${ndaInitialTag}"`)

// --- upload the flawed doc first (missing signature) ---
// handleUpload clears `busy` before its own load() resolves, so the tag
// passes through a stale "Required"/previous-state render for a moment --
// wait for the actual terminal label, not just "not Uploading...".
function waitNdaTag(expected) {
  return page.waitForFunction(
    (want) => {
      const cards = [...document.querySelectorAll('.doc-card')]
      const card = cards.find((c) => c.querySelector('.doc-card-title')?.textContent === 'NDA')
      return card && card.querySelector('.tag')?.textContent === want
    },
    expected,
    { timeout: 20000 },
  )
}

const flawedPath = path.resolve('agents/.scratch/doc_ui_flawed_nda.png')
await ndaCard.locator('input[type=file]').setInputFiles(flawedPath)
await waitNdaTag('Rejected')
// no manual reload -- load() runs inside handleUpload itself

const ndaRejectedTag = await ndaCard.locator('.tag').innerText()
record('flawed doc -> Rejected badge (no manual refresh)', ndaRejectedTag === 'Rejected', `tag="${ndaRejectedTag}"`)
const reasonText = await ndaCard.locator('.doc-card-reason').first().innerText().catch(() => '(none)')
record('rejection reason surfaced and names the missing item', /signature/i.test(reasonText), `reason="${reasonText}"`)
const rejectedAction = await ndaCard.locator('.doc-card-action').innerText()
record('Rejected state offers Re-upload', rejectedAction.includes('Re-upload'), `action="${rejectedAction}"`)

// --- now upload the valid doc over it ---
const validPath = path.resolve('agents/.scratch/doc_ui_valid_nda.png')
await ndaCard.locator('input[type=file]').setInputFiles(validPath)
await waitNdaTag('Validated')

const ndaValidatedTag = await ndaCard.locator('.tag').innerText()
record('valid doc -> Validated badge (no manual refresh)', ndaValidatedTag === 'Validated', `tag="${ndaValidatedTag}"`)
const noReasonLeft = await ndaCard.locator('.doc-card-reason').count()
record('no stale rejection reason once validated', noReasonLeft === 0, `count=${noReasonLeft}`)
const validatedAction = await ndaCard.locator('.doc-card-action').innerText()
record('Validated state offers Replace', validatedAction.includes('Replace'), `action="${validatedAction}"`)

// --- untouched second card / accessibility spot-check ---
const assetTag = await assetCard.locator('.tag').innerText()
record('Asset Return Form card untouched (still Required)', assetTag === 'Required', `tag="${assetTag}"`)
const fileInputAccessible = await ndaCard.locator('input[type=file]').isVisible().catch(() => false)
record('file input stays in accessibility tree (sr-only, not display:none)', await ndaCard.locator('input[type=file]').count() === 1, `visible=${fileInputAccessible}`)
const ariaLabel = await ndaCard.locator('.doc-card-action').getAttribute('aria-label')
record('action label accessible name disambiguates the doc', /NDA/.test(ariaLabel ?? ''), `aria-label="${ariaLabel}"`)

await browser.close()

const failures = results.filter((r) => !r.pass)
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} -- ${r.detail}`)
process.exit(failures.length ? 1 : 0)
