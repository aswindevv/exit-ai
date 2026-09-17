import fs from 'fs'
import { chromium } from 'playwright'
import { svc, login, trackErrors, employee, j, APP } from './lib.mjs'
const SH = 'scripts/_review/shots/'
const { caseId } = JSON.parse(fs.readFileSync('scripts/_review/b_state.json','utf8'))
const db = svc(); const E = employee('Emp030')
const b = await chromium.launch(); const ctx = await b.newContext({ viewport:{width:1440,height:900} })
const page = await ctx.newPage(); const errs = trackErrors(page)
await login(page, E.email, E.password); await page.waitForTimeout(1500)
console.log('url after login (has case now):', page.url())
await page.screenshot({ path: SH+'b04_emp030_dashboard.png', fullPage: true })

await page.goto(APP+'/employee/tasks', { waitUntil:'networkidle' }); await page.waitForTimeout(1200)
await page.screenshot({ path: SH+'b05_emp030_tasks_before.png', fullPage: true })
const rows = page.locator('.row')
console.log('task rows visible:', await rows.count())
console.log('row texts:'); for (const t of await rows.allInnerTexts()) console.log('  |', t.replace(/\n/g,' ~ '))

const HR = ['Confirm final pay and benefits details','Return company-issued equipment','Update personal contact information']
for (const title of HR) {
  const row = page.locator('.row', { hasText: title })
  const n = await row.count()
  if (n !== 1) { console.log('SCOPE FAIL', title, 'count=', n); continue }
  const btn = row.getByRole('button', { name: /Mark done/ })
  if (await btn.count() !== 1) { console.log('NO BUTTON for', title, await row.innerText()); continue }
  await btn.click()
  await page.waitForTimeout(2500)
  const { data } = await db.from('exit_tasks').select('status').eq('case_id',caseId).eq('title',title).single()
  console.log('clicked:', title, '-> db status =', data?.status, '| rowtext:', (await row.innerText()).replace(/\n/g,' ~ '))
}
await page.waitForTimeout(1500)
await page.screenshot({ path: SH+'b06_emp030_tasks_after.png', fullPage: true })
await page.goto(APP+'/employee', { waitUntil:'networkidle' }); await page.waitForTimeout(1500)
await page.screenshot({ path: SH+'b07_emp030_dashboard_hr_done.png', fullPage: true })
const { data: tks } = await db.from('exit_tasks').select('stage,title,status').eq('case_id',caseId).order('stage')
for (const t of tks) console.log('DB', t.stage, t.status, t.title)
const { data: ar } = await db.from('agent_runs').select('agent,stage,detail,created_at').eq('case_id',caseId).order('created_at')
console.log('agent_runs now:', ar.length); for (const r of ar) console.log('  ', r.agent, r.stage, '::', String(r.detail).slice(0,140))
console.log('CONSOLE ERRORS:', j(errs))
await b.close()
