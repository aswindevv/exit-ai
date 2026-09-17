import { chromium } from 'playwright'
import { login, trackErrors, ACCOUNTS, APP } from './lib.mjs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } })
const errs = trackErrors(p)
await login(p, ACCOUNTS.hr.email, ACCOUNTS.hr.password)
await p.waitForTimeout(2500)
console.log('URL after login:', p.url())
console.log('body after login (first 25 lines):\n' + (await p.locator('body').innerText()).split('\n').filter(l=>l.trim()).slice(0,25).join('\n'))
const ls = await p.evaluate(() => Object.keys(localStorage))
console.log('localStorage keys:', JSON.stringify(ls))
// navigate by CLICKING the nav link (no action buttons), not by goto
const link = p.getByRole('link', { name: /policy audit/i })
console.log('policy-audit nav link count:', await link.count())
if (await link.count() === 1) {
  await link.click(); await p.waitForTimeout(2000)
  console.log('URL now:', p.url())
  await p.screenshot({ path: 'scripts/_review/c2_hr_policy_audit.png', fullPage: true })
  console.log('--- POLICY AUDIT PAGE ---\n' + (await p.locator('body').innerText()).split('\n').filter(l=>l.trim()).slice(0,45).join('\n'))
}
const rl = p.getByRole('link', { name: /^reports$/i })
if (await rl.count() === 1) { await rl.click(); await p.waitForTimeout(2000); await p.screenshot({ path:'scripts/_review/c2_hr_reports.png', fullPage:true })
  console.log('\n--- REPORTS PAGE ---\n' + (await p.locator('body').innerText()).split('\n').filter(l=>l.trim()).slice(0,45).join('\n')) }
console.log('\nCONSOLE ERRORS: ' + (errs.length? errs.join('\n'):'none'))
await b.close()
