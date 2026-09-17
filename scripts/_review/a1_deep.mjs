import { chromium } from 'playwright'
import { APP, ACCOUNTS, login, trackErrors } from './lib.mjs'
const settle = async (p) => { try { await p.waitForLoadState('networkidle', { timeout: 12000 }) } catch {}; await p.waitForTimeout(700) }
const browser = await chromium.launch()
const PROBES = ['/hr/all-exits','/hr/exit-interviews','/manager/kt-approvals','/it/approvals','/finance','/employee/tasks','/nonsense','/hr/does-not-exist']
for (const k of ['manager','finance','hr']) {
  const a = ACCOUNTS[k]
  const ctx = await browser.newContext({ viewport:{width:1280,height:800} })
  const page = await ctx.newPage(); const errs = trackErrors(page)
  await login(page, a.email, a.password); await settle(page)
  for (const u of PROBES) {
    await page.goto(APP+u, { waitUntil:'domcontentloaded' }); await settle(page)
    const roleEl = page.locator('.sidebar .user-meta .role')
    const role = await roleEl.count() ? (await roleEl.innerText()) : 'none'
    const title = await page.locator('.card-title').first().innerText().catch(()=> '-')
    console.log(`[${k}] ${u.padEnd(24)} -> ${page.url().replace(APP,'').padEnd(26)} role=${role.padEnd(8)} firstCard=${JSON.stringify(title.slice(0,40))}`)
  }
  console.log(`[${k}] errs`, JSON.stringify([...new Set(errs)]))
  await ctx.close()
}
await browser.close()
