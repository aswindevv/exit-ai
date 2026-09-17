import { chromium } from 'playwright'
import { svc, login, trackErrors, employee, casesFor, j } from './lib.mjs'
const SH = 'scripts/_review/shots/'
const db = svc()
const E = employee('Emp030')
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errs = trackErrors(page)
const net = []
page.on('request', r => { if (r.url().includes('8787') || r.url().includes('submit-resignation')) net.push(r.method()+' '+r.url()) })

await login(page, E.email, E.password)
await page.waitForTimeout(1500)
console.log('STEP1 url after login:', page.url())
await page.screenshot({ path: SH+'b01_emp030_after_login.png', fullPage: true })
console.log('STEP1 heading:', (await page.locator('h2').allInnerTexts()).join(' | '))

// step 2
const lwd = new Date(Date.now() + 30*86400000).toISOString().slice(0,10)
console.log('STEP2 last_working_day =', lwd)
await page.fill('#resign-last-day', lwd)
await page.fill('#resign-reason', 'Review harness disposable case - better opportunity elsewhere')
await page.screenshot({ path: SH+'b02_resignation_form_filled.png', fullPage: true })
const t0 = Date.now()
await page.click('button.login-submit')
await page.waitForURL('**/employee', { timeout: 120000 }).catch(e => console.log('STEP2 waitForURL fail', e.message))
const tms = Date.now() - t0
console.log('STEP2 submit->navigate ms =', tms)
console.log('STEP2 network:', j(net))
await page.waitForTimeout(3000)
await page.screenshot({ path: SH+'b03_emp030_dashboard_after_submit.png', fullPage: true })
console.log('STEP2 url:', page.url())
console.log('ERRORS so far:', j(errs))

const cases = await casesFor('Emp030')
console.log('STEP2 cases:', j(cases))
const cid = cases[0]?.id
if (cid) {
  const { data: c } = await db.from('exit_cases').select('*').eq('id', cid).single()
  console.log('STEP2 case row:', j(c))
  const { data: mp } = await db.from('profiles').select('full_name,email').eq('id', c.manager_id).maybeSingle()
  const { data: hp } = await db.from('profiles').select('full_name,email').eq('id', c.hr_id).maybeSingle()
  console.log('STEP3 manager_id ->', c.manager_id, j(mp))
  console.log('STEP3 hr_id ->', c.hr_id, j(hp))
  const { data: tks } = await db.from('exit_tasks').select('stage,title,status,due_date').eq('case_id', cid).order('stage')
  console.log('STEP2 tasks n=', tks.length)
  for (const t of tks) console.log('  ', t.stage, '|', t.status, '|', t.due_date, '|', t.title)
  const { data: ar } = await db.from('agent_runs').select('agent,stage,detail,created_at').eq('case_id', cid).order('created_at')
  console.log('STEP2 agent_runs:', ar.length)
  for (const r of ar) console.log('  ', r.created_at, r.agent, r.stage, '::', String(r.detail).slice(0,160))
  require_nothing: {}
  // due date expectation
  const d = (n) => new Date(Date.parse(lwd) - n*86400000).toISOString().slice(0,10)
  console.log('STEP2 expected due dates: lwd-3 =', d(3), ' lwd-1 =', d(1))
  await require('fs').promises?.writeFile?.('x','x').catch?.(()=>{})
}
import fs from 'fs'
fs.writeFileSync('scripts/_review/b_state.json', JSON.stringify({ caseId: cid, lwd }))
await ctx.storageState({ path: 'scripts/_review/emp030_state.json' })
await b.close()
