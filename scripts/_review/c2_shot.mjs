// READ-ONLY: login as HR, navigate to two pages, screenshot. No clicks on any action button.
import { chromium } from 'playwright'
import { login, trackErrors, ACCOUNTS, APP } from './lib.mjs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } })
const errs = trackErrors(p)
await login(p, ACCOUNTS.hr.email, ACCOUNTS.hr.password)
for (const [route, name] of [['/hr/policy-audit','c2_hr_policy_audit'], ['/hr/reports','c2_hr_reports']]) {
  await p.goto(APP + route, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  await p.screenshot({ path: 'scripts/_review/' + name + '.png', fullPage: true })
  const body = await p.locator('body').innerText()
  console.log('\n===== ' + route + ' =====')
  console.log(body.split('\n').filter(l=>l.trim()).slice(0, 40).join('\n'))
}
// does anything in the HR nav surface workflow_optimizer / predictive_attrition?
const nav = await p.locator('nav').first().innerText().catch(()=> '(no nav)')
console.log('\n===== HR NAV =====\n' + nav)
console.log('\nCONSOLE ERRORS: ' + (errs.length ? errs.join('\n') : 'none'))
await b.close()
