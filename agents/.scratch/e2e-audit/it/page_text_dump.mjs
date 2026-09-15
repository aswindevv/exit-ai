import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })

const routes = ['', 'deprovisioning', 'asset-recovery', 'access-reviews', 'approvals', 'audit-log', 'help']
for (const r of routes) {
  await page.goto(`http://localhost:5173/it/${r}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const text = await page.locator('body').innerText()
  console.log(`\n===== /it/${r} =====`)
  console.log(text)
  // list buttons
  const buttons = await page.locator('button').all()
  const btnTexts = []
  for (const b of buttons) {
    btnTexts.push((await b.innerText()).replace(/\s+/g, ' ').trim())
  }
  console.log('BUTTONS:', JSON.stringify(btnTexts))
}

await browser.close()
