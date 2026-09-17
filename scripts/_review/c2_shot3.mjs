import { chromium } from 'playwright'
import { login, trackErrors, ACCOUNTS } from './lib.mjs'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } })
const errs = trackErrors(p)
await login(p, ACCOUNTS.hr.email, ACCOUNTS.hr.password)
await p.waitForTimeout(2500)
const l = p.getByRole('link', { name: /^trends$/i })
console.log('trends link count:', await l.count())
await l.click(); await p.waitForTimeout(2000)
await p.screenshot({ path: 'scripts/_review/c2_hr_trends.png', fullPage: true })
console.log('--- TRENDS PAGE ---\n' + (await p.locator('body').innerText()).split('\n').filter(x=>x.trim()).slice(11,50).join('\n'))
console.log('\nCONSOLE ERRORS: ' + (errs.length? errs.join('\n'):'none'))
await b.close()
