import fs from 'fs'
import { chromium } from 'playwright'
import { svc, login, trackErrors, ACCOUNTS, j, APP } from './lib.mjs'
const SH='scripts/_review/shots/'
const { caseId } = JSON.parse(fs.readFileSync('scripts/_review/b_state.json','utf8'))
const db=svc(); const H=ACCOUNTS.hr
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:1100}})
const page=await ctx.newPage(); const errs=trackErrors(page)
const net=[]; page.on('response', async r=>{ if(r.url().includes('8787')) net.push(new URL(r.url()).pathname+' -> '+r.status()+' '+(await r.text().catch(()=>'')).slice(0,300)) })
await login(page, H.email, H.password); await page.waitForTimeout(2500)
console.log('hr url:', page.url())
await page.screenshot({path:SH+'b20_hr_dash.png', fullPage:true})
await page.goto(APP+'/hr/clearances',{waitUntil:'networkidle'}); await page.waitForTimeout(2500)
await page.screenshot({path:SH+'b21_hr_clearances_before.png', fullPage:true})
const row=page.locator('.row',{hasText:'Ishaan Nair'}).filter({has:page.getByRole('button',{name:'Issue relieving letter'})})
console.log('issue rows for Ishaan Nair:', await row.count())
const anyRow=page.locator('.row',{hasText:'Ishaan Nair'})
console.log('all Ishaan Nair rows on HR clearances:', await anyRow.count())
for(const t of await anyRow.allInnerTexts()) console.log('  |', t.replace(/\n/g,' ~ '))
if(await row.count()===1){
  await row.getByRole('button',{name:'Issue relieving letter'}).click()
  await page.waitForTimeout(9000); console.log('CLICKED issue')
} else console.log('BLOCKER: issue button not offered')
await page.screenshot({path:SH+'b22_hr_clearances_after.png', fullPage:true})
console.log('NET:', j(net))
const {data:cs}=await db.from('exit_cases').select('status,relieving_letter_issued,issued_at,issued_by,finance_cleared').eq('id',caseId).single()
console.log('CASE:', j(cs))
const {data:hp}=await db.from('profiles').select('full_name,email').eq('id',cs.issued_by).maybeSingle()
console.log('issued_by ->', j(hp))
const {data:ar}=await db.from('agent_runs').select('agent,stage,detail,created_at').eq('case_id',caseId).order('created_at')
console.log('AGENT_RUNS n=',ar.length); for(const r of ar) console.log('  ',r.created_at,r.agent,'/',r.stage,'::',String(r.detail).slice(0,140))
// HR agent-activity page
await page.goto(APP+'/hr/agent-activity',{waitUntil:'networkidle'}); await page.waitForTimeout(2500)
await page.screenshot({path:SH+'b23_hr_agentactivity.png', fullPage:true})
const aa=await page.evaluate(()=>[...document.querySelectorAll('.row')].map(r=>r.innerText.replace(/\n/g,' ~ ')).filter(t=>/Ishaan Nair|product analytics|product repo/i.test(t)).slice(0,20))
console.log('agent-activity rows for case:', j(aa))
console.log('CONSOLE ERRORS:', j(errs))
await b.close()
