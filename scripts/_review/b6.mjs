import fs from 'fs'
import { chromium } from 'playwright'
import { svc, login, trackErrors, ACCOUNTS, j, APP } from './lib.mjs'
const SH='scripts/_review/shots/'
const { caseId } = JSON.parse(fs.readFileSync('scripts/_review/b_state.json','utf8'))
const db=svc(); const F=ACCOUNTS.finance
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:1000}})
const page=await ctx.newPage(); const errs=trackErrors(page)
const net=[]; page.on('response', async r=>{ if(r.url().includes('8787')) net.push(new URL(r.url()).pathname+' -> '+r.status()+' '+(await r.text().catch(()=>'')).slice(0,400)) })
await login(page, F.email, F.password); await page.waitForTimeout(2500)
console.log('finance url:', page.url())
await page.screenshot({path:SH+'b18_finance_dash.png', fullPage:true})
const row=page.locator('.row',{hasText:'Ishaan Nair'})
console.log('finance rows for Ishaan Nair:', await row.count())
for(const t of await row.allInnerTexts()) console.log('  |', t.replace(/\n/g,' ~ '))
if(await row.count()===1){
  const btn=row.getByRole('button',{name:/Mark dues settled|Settle/i})
  console.log('settle buttons:', await btn.count(), (await row.getByRole('button').allInnerTexts()).join(' / '))
  if(await btn.count()===1){ await btn.click(); await page.waitForTimeout(8000); console.log('CLICKED settle') }
}
await page.screenshot({path:SH+'b19_finance_after_settle.png', fullPage:true})
console.log('row after:', (await row.first().innerText().catch(()=>'')).replace(/\n/g,' ~ '))
console.log('NET:', j(net))
const {data:cs}=await db.from('exit_cases').select('status,finance_cleared,dues_note,relieving_letter_issued').eq('id',caseId).single()
console.log('CASE:', j(cs))
const {data:t2}=await db.from('exit_tasks').select('stage,title,status').eq('case_id',caseId).order('stage')
for(const t of t2) console.log('TASK',t.stage,'|',t.status,'|',t.title)
const {data:cc}=await db.from('compliance_checks').select('item,status,failure_reason').eq('case_id',caseId).order('item')
console.log('COMPLIANCE:', j(cc))
const {data:rpc}=await db.rpc('exit_case_cleared_for_relieving',{p_case_id:caseId})
console.log('rpc cleared_for_relieving:', j(rpc))
console.log('CONSOLE ERRORS:', j(errs))
await b.close()
