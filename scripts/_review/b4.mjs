import fs from 'fs'
import { chromium } from 'playwright'
import { svc, login, trackErrors, ACCOUNTS, j, APP } from './lib.mjs'
const SH='scripts/_review/shots/'
const { caseId } = JSON.parse(fs.readFileSync('scripts/_review/b_state.json','utf8'))
const db=svc(); const IT=ACCOUNTS.it
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:1000}})
const page=await ctx.newPage(); const errs=trackErrors(page)
const net=[]; page.on('response', async r=>{ if(r.url().includes('8787')) net.push(r.request().method()+' '+new URL(r.url()).pathname+' -> '+r.status()+' '+(await r.text().catch(()=>'')).slice(0,260)) })
await login(page, IT.email, IT.password); await page.waitForTimeout(2000)
console.log('IT url:', page.url())
await page.goto(APP+'/it/approvals',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
await page.screenshot({path:SH+'b12_it_approvals_before.png', fullPage:true})
const scoped = await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.row')]
  const i=rows.findIndex(r=>r.dataset.groupHeader==='true' && r.innerText.includes('Ishaan Nair'))
  if(i<0) return {found:false, headers: rows.filter(r=>r.dataset.groupHeader==='true').map(r=>r.innerText.replace(/\n/g,' ~ ')).slice(0,20)}
  const out=[]; for(let k=i+1;k<rows.length;k++){ if(rows[k].dataset.groupHeader==='true') break; out.push(rows[k].innerText.replace(/\n/g,' ~ ')) }
  return {found:true, header: rows[i].innerText.replace(/\n/g,' ~ '), rows: out}
})
console.log('IT group Ishaan Nair:', j(scoped))
const ITT=['Remove product repo access','Collect company laptop','Collect access card','Disable SSO account','Revoke product analytics application accounts']
for(const title of ITT){
  const row=page.locator('.row',{hasText:title})
  const n=await row.count()
  if(n!==1){ console.log('SCOPE FAIL count=',n,title); continue }
  const btn=row.getByRole('button',{name:/Approve/})
  if(await btn.count()!==1){ console.log('NO Approve button:',title,(await row.innerText()).replace(/\n/g,' ~ ')); continue }
  await btn.click(); await page.waitForTimeout(6000)
  const {data}=await db.from('exit_tasks').select('status').eq('case_id',caseId).eq('title',title).single()
  console.log('IT approved:',title,'-> db',data?.status)
}
await page.waitForTimeout(3000)
await page.screenshot({path:SH+'b13_it_approvals_after.png', fullPage:true})
await page.goto(APP+'/it/deprovisioning',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
await page.screenshot({path:SH+'b14_it_deprovisioning.png', fullPage:true})
const dep = await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.row')]
  const i=rows.findIndex(r=>r.dataset.groupHeader==='true' && r.innerText.includes('Ishaan Nair'))
  if(i<0) return {found:false}
  const out=[]; for(let k=i+1;k<rows.length;k++){ if(rows[k].dataset.groupHeader==='true') break; out.push(rows[k].innerText.replace(/\n/g,' ~ ')) }
  return {found:true, rows: out}
})
console.log('deprovisioning page Ishaan Nair:', j(dep))
await page.goto(APP+'/it/audit-log',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
await page.screenshot({path:SH+'b15_it_auditlog.png', fullPage:true})
const al = await page.evaluate(()=> [...document.querySelectorAll('.row')].map(r=>r.innerText.replace(/\n/g,' ~ ')).filter(t=>/Ishaan Nair|product repo|SSO|analytics/i.test(t)).slice(0,20))
console.log('audit-log rows mentioning case:', j(al))
console.log('NET:', j(net))
const {data:ar}=await db.from('agent_runs').select('agent,stage,detail,created_at').eq('case_id',caseId).order('created_at')
console.log('AGENT_RUNS n=',ar.length); for(const r of ar) console.log('  ',r.created_at,r.agent,'/',r.stage,'::',String(r.detail).slice(0,200))
const {data:t2}=await db.from('exit_tasks').select('stage,title,status').eq('case_id',caseId).order('stage')
for(const t of t2) console.log('TASK',t.stage,'|',t.status,'|',t.title)
const {data:cc}=await db.from('compliance_checks').select('*').eq('case_id',caseId)
console.log('COMPLIANCE_CHECKS:', j(cc))
const {data:vs}=await db.from('exit_cases').select('status,finance_cleared,risk_level').eq('id',caseId).single()
console.log('CASE:', j(vs))
console.log('CONSOLE ERRORS:', j(errs))
await b.close()
