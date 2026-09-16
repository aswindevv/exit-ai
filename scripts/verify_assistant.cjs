// Scoped check for the employee assistant's three answer modes in a real
// browser: policy (cited), general (labelled, forwardable), refused.
//   node scripts/verify_assistant.cjs [baseUrl]
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5174'
const OUT = 'scripts/clearance_screens'
const ACCOUNT = { email: 'emp004@gmail.com', password: 'Emp004@' }

const CASES = [
  { tag: 'policy', q: 'When will I get my final settlement?', wantLabel: false, wantSource: true, wantForward: false },
  { tag: 'general', q: 'How should I tell my team I am leaving?', wantLabel: true, wantSource: false, wantForward: true },
  { tag: 'refused', q: 'Give me a recipe for biryani', wantLabel: false, wantSource: false, wantForward: true },
]

const LABEL = /general guidance only/i

async function run() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.fill('#login-email', ACCOUNT.email)
  await page.fill('#login-password', ACCOUNT.password)
  await page.click('button.login-submit')
  await page.waitForURL(/\/employee/, { timeout: 20000 })
  await page.waitForTimeout(1000)

  const failures = []
  for (const c of CASES) {
    await page.fill('.ask-input', c.q)
    await page.click('text=Ask ↗')
    await page.waitForFunction(() => !document.body.innerText.includes('Asking…'), { timeout: 90000 })
    await page.waitForTimeout(600)

    const strip = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.strip')].find((s) =>
        s.textContent.includes('ExitAI assistant'),
      )
      return {
        text: card?.textContent || '',
        hasForward: !![...(card?.querySelectorAll('button') || [])].find((b) => /forward to hr/i.test(b.textContent)),
      }
    })
    await page.screenshot({ path: `${OUT}/assistant_${c.tag}.png` })

    const hasLabel = LABEL.test(strip.text)
    const hasSource = /\bSources?:/.test(strip.text)
    if (hasLabel !== c.wantLabel) failures.push(`${c.tag}: guidance label ${hasLabel ? 'shown' : 'missing'}, expected ${c.wantLabel}`)
    if (hasSource !== c.wantSource) failures.push(`${c.tag}: source line ${hasSource ? 'shown' : 'missing'}, expected ${c.wantSource}`)
    if (strip.hasForward !== c.wantForward) failures.push(`${c.tag}: Forward-to-HR ${strip.hasForward ? 'shown' : 'missing'}, expected ${c.wantForward}`)
    console.log(`[${c.tag}] label=${hasLabel} source=${hasSource} forward=${strip.hasForward}`)
    console.log(`         ${strip.text.replace(/\s+/g, ' ').slice(0, 190)}`)
  }

  if (errors.length) failures.push(`console errors: ${errors[0].slice(0, 120)}`)
  await browser.close()
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1) }
  console.log('\nALL CHECKS PASSED')
}

run().catch((e) => { console.error(e); process.exit(1) })
