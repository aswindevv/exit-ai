import { chromium } from 'playwright'
import { login, employee, trackErrors, APP } from './lib.mjs'

const emp = employee('Emp022')
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } })
const errs = trackErrors(page)

// capture the network call to /ask
const calls = []
page.on('response', async (r) => {
  if (r.url().includes('/functions/v1/')) {
    let body = null
    try { body = await r.text() } catch {}
    calls.push({ url: r.url().split('/functions/v1/')[1], status: r.status(), body: (body||'').slice(0,900) })
  }
})

await login(page, emp.email, emp.password)
console.log('URL after login:', page.url())
await page.waitForTimeout(1500)
await page.screenshot({ path: 'scripts/_review/shots/d_emp_dash.png', fullPage: true })

const input = page.locator('input.ask-input')
console.log('ask-input count:', await input.count())

async function ask(q, shot) {
  await input.fill(q)
  const t0 = Date.now()
  await input.press('Enter')
  // wait until strip body changes away from placeholder
  await page.waitForFunction(() => {
    const el = document.querySelector('.strip--top')
    return el && !el.textContent.includes('Ask me anything about your exit process.')
  }, { timeout: 60000 }).catch(() => console.log('   (timeout waiting for answer)'))
  const ms = Date.now() - t0
  const strip = page.locator('.strip--top')
  const txt = (await strip.innerText()).replace(/\n+/g, ' | ')
  const fwd = strip.getByRole('button', { name: /Forward to HR/i })
  const fwdCount = await fwd.count()
  console.log(`\n--- BROWSER ASK (${ms} ms): ${q}`)
  console.log('   STRIP: ' + txt)
  console.log('   Forward-to-HR button count: ' + fwdCount)
  await page.screenshot({ path: 'scripts/_review/shots/' + shot, fullPage: false })
  return { ms, txt, fwdCount }
}

await ask('What is the minimum notice period I must serve when I resign?', 'd_ask_policy.png')
await ask("What's a good pasta recipe?", 'd_ask_refused.png')
await ask('Any tips for negotiating salary at my next job?', 'd_ask_general.png')

// help page
await page.goto(APP + '/employee/help', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
console.log('\nHELP PAGE URL:', page.url())
console.log('HELP PAGE TEXT:\n' + (await page.locator('.card').first().innerText()))
console.log('help page has ask-input:', await page.locator('input.ask-input').count())
await page.screenshot({ path: 'scripts/_review/shots/d_help.png', fullPage: true })

console.log('\n=== EDGE FUNCTION CALLS SEEN ===')
for (const c of calls) console.log(c.status + ' ' + c.url + ' :: ' + c.body)
console.log('\n=== CONSOLE ERRORS (' + errs.length + ') ===')
for (const e of errs) console.log(e)
await b.close()
