import fs from 'fs'
import { chromium } from 'playwright'
import { svc, login, trackErrors, ACCOUNTS, j, APP } from './lib.mjs'
const SH='scripts/_review/shots/'
const { caseId } = JSON.parse(fs.readFileSync('scripts/_review/b_state.json','utf8'))
const db=svc(); const M=ACCOUNTS.manager
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:1000}})
const page=await ctx.newPage(); const errs=trackErrors(page)
const net=[]; page.on('response', async r=>{ if(r.url().includes('8787')) net.push(r.request().method()+' '+r.url()+' -> '+r.status()+' '+(await r.text().catch(()=>'')).slice(0,200)) })
await login(page, M.email, M.password); await page.waitForTimeout(2000)
console.log('manager url:', page.url())
await page.goto(APP+'/manager/kt-approvals',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
await page.screenshot({path:SH+'b08_mgr_kt_before.png', fullPage:true})

// --- scope assertion: rows under the "Ishaan Nair" group header
const scoped = await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.list .row')]
  const i=rows.findIndex(r=>r.dataset.groupHeader==='true' && r.innerText.includes('Ishaan Nair'))
  if(i<0) return {found:false}
  const out=[]
  for(let k=i+1;k<rows.length;k++){ if(rows[k].dataset.groupHeader==='true') break; out.push(rows[k].innerText.replace(/\n/g,' ~ ')) }
  return {found:true, header: rows[i].innerText.replace(/\n/g,' ~ '), rows: out}
})
console.log('KT group for Ishaan Nair:', j(scoped))

const KT=['Document product analysis workflows','Transfer dashboard and reporting ownership','Handover active product insights and experiments','Revoke access to product analytics tools']
for(const title of KT){
  const row=page.locator('.row.kt-row',{hasText:title})
  const n=await row.count()
  if(n!==1){ console.log('SCOPE FAIL count=',n,title); continue }
  const btn=row.getByRole('button',{name:'Review'})
  if(await btn.count()!==1){ console.log('NO Review button:', title, (await row.innerText()).replace(/\n/g,' ~ ')); continue }
  await btn.click(); await page.waitForTimeout(3500)
  const {data}=await db.from('exit_tasks').select('status').eq('case_id',caseId).eq('title',title).single()
  console.log('approved:',title,'-> db',data?.status)
}
await page.waitForTimeout(2000)
await page.screenshot({path:SH+'b09_mgr_kt_after.png', fullPage:true})
console.log('NET after KT:', j(net))
// state after KT approvals, before Sign clearance
let {data:t1}=await db.from('exit_tasks').select('stage,title,status').eq('case_id',caseId)
console.log('stages after KT approve:', j(t1.reduce((a,t)=>{a[t.stage]=(a[t.stage]||0)+1;return a},{})))
let {data:ar1}=await db.from('agent_runs').select('agent,stage,detail').eq('case_id',caseId)
console.log('agent_runs after KT approve:', ar1.length, j(ar1.map(r=>r.agent+'/'+r.stage+'::'+String(r.detail).slice(0,90))))

// --- clearances page
net.length=0
await page.goto(APP+'/manager/clearances',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
const crow=page.locator('.row',{hasText:'Ishaan Nair'})
console.log('clearance rows matching Ishaan Nair:', await crow.count())
console.log('clearance row text:', (await crow.first().innerText().catch(()=>'')).replace(/\n/g,' ~ '))
await page.screenshot({path:SH+'b10_mgr_clearances_before.png', fullPage:true})
const sbtn=crow.getByRole('button',{name:/Sign clearance/})
if(await sbtn.count()===1){ await sbtn.click(); await page.waitForTimeout(6000); console.log('CLICKED Sign clearance') }
else console.log('NO Sign clearance button; count=', await sbtn.count())
await page.screenshot({path:SH+'b11_mgr_clearances_after.png', fullPage:true})
console.log('clearance row after:', (await crow.first().innerText().catch(()=>'')).replace(/\n/g,' ~ '))
console.log('NET clearance:', j(net))

// --- step 6 assertions
const {data:t2}=await db.from('exit_tasks').select('stage,title,status,due_date').eq('case_id',caseId).order('stage')
console.log('TASKS now n=',t2.length); for(const t of t2) console.log('  ',t.stage,'|',t.status,'|',t.title)
const {data:ar2}=await db.from('agent_runs').select('agent,stage,detail,created_at').eq('case_id',caseId).order('created_at')
console.log('AGENT_RUNS n=',ar2.length); for(const r of ar2) console.log('  ',r.created_at,r.agent,'/',r.stage,'::',String(r.detail).slice(0,150))
const {data:cs}=await db.from('exit_cases').select('status,risk_level,risk_score,finance_cleared').eq('id',caseId).single()
console.log('CASE:', j(cs))
console.log('IT task count:', t2.filter(t=>t.stage==='it').length)
console.log('CONSOLE ERRORS:', j(errs))
await b.close()
