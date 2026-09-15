import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })

for (const r of ['deprovisioning', 'audit-log', '']) {
  await page.goto(`http://localhost:5173/it/${r}`, { waitUntil: 'networkidle' })
  const text = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div'))
    const header = all.find((d) => d.textContent.trim().startsWith('Ishaan Gupta'))
    if (!header) return 'NO HEADER FOUND for Ishaan Gupta on this page'
    let el = header
    let out = []
    for (let i = 0; i < 6 && el.nextElementSibling; i++) {
      el = el.nextElementSibling
      out.push(el.textContent)
    }
    return out.join(' | ')
  })
  console.log(`--- /it/${r} --- Ishaan Gupta block:`, text)
}

await browser.close()
