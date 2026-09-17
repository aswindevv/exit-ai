import { chromium } from 'playwright'
import { APP, ACCOUNTS, employee, login, trackErrors } from './lib.mjs'
const S = 'scripts/_review/shots/'
const settle = async (p) => { try { await p.waitForLoadState('networkidle', { timeout: 12000 }) } catch {}; await p.waitForTimeout(800) }
const txt = async (p) => (await p.locator('body').innerText().catch(()=> '')).replace(/[ \t]+/g,' ').trim()

const browser = await chromium.launch()

// --- 1. Emp021 redirect timing (no case -> resignation gate)
{
  const ctx = await browser.newContext({ viewport:{width:1440,height:950} })
  const page = await ctx.newPage(); const errs = trackErrors(page)
  const t0 = Date.now()
  await login(page, 'emp021@gmail.com', 'Emp021@')
  const urlAtLogin = page.url()
  let reached = null
  try { await page.waitForURL('**/employee/resignation', { timeout: 20000 }); reached = Date.now()-t0 } catch {}
  console.log('[Emp021] urlImmediatelyAfterLogin=', urlAtLogin, '| finalUrl=', page.url(), '| ms_to_resignation=', reached)
  console.log('[Emp021] gate text:', (await txt(page)).slice(0,300).replace(/\n/g,' | '))
  console.log('[Emp021] has sidebar?', await page.locator('.sidebar').count())
  // deep cross-role routes as an employee with no case
  for (const u of ['/hr/all-exits','/manager/kt-approvals','/it/deprovisioning','/finance']) {
    await page.goto(APP+u, { waitUntil:'domcontentloaded' }); await settle(page)
    console.log('  [Emp021 deep]', u, '->', page.url().replace(APP,''), '| sidebar=', await page.locator('.sidebar').count(), '| snippet=', (await txt(page)).slice(0,80).replace(/\n/g,' '))
  }
  console.log('[Emp021] errs', JSON.stringify([...new Set(errs)]))
  await ctx.close()
}

// --- 2. full text of short/placeholder routes
const CASES = [
  ['emp022', 'emp022@gmail.com', 'Emp022@', ['/employee/my-exit','/employee/documents','/employee/exit-interview','/employee/timeline','/employee/knowledge-transfer']],
  ['hr', ACCOUNTS.hr.email, ACCOUNTS.hr.password, ['/hr/trends','/hr/settings','/hr/escalations','/hr/reports']],
  ['it', ACCOUNTS.it.email, ACCOUNTS.it.password, ['/it/access-reviews']],
]
for (const [tag, em, pw, urls] of CASES) {
  const ctx = await browser.newContext({ viewport:{width:1440,height:950} })
  const page = await ctx.newPage(); const errs = trackErrors(page)
  await login(page, em, pw); await settle(page)
  for (const u of urls) {
    await page.goto(APP+u, { waitUntil:'domcontentloaded' }); await settle(page)
    const body = await txt(page)
    const main = body.split('Help and support').pop()
    console.log(`\n--- [${tag}] ${u}  (final ${page.url().replace(APP,'')})\n${main.trim().slice(0,700)}`)
    await page.screenshot({ path: `${S}a1_${tag}_${u.split('/').pop()}.png` })
  }
  // deep cross-role check for this role
  const other = tag==='hr' ? '/it/audit-log' : tag==='it' ? '/hr/all-exits' : '/hr/clearances'
  await page.goto(APP+other, { waitUntil:'domcontentloaded' }); await settle(page)
  console.log(`[${tag}] deep cross ${other} -> ${page.url().replace(APP,'')} role=${await page.locator('.sidebar .user-meta .role').count() ? await page.locator('.sidebar .user-meta .role').innerText() : 'none'}`)
  console.log(`[${tag}] errs`, JSON.stringify([...new Set(errs)]))
  await ctx.close()
}
await browser.close()
