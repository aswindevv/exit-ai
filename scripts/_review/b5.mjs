import fs from 'fs'
import { chromium } from 'playwright'
import { svc, login, trackErrors, ACCOUNTS, j, APP } from './lib.mjs'
const SH='scripts/_review/shots/'
const { caseId } = JSON.parse(fs.readFileSync('scripts/_review/b_state.json','utf8'))
const db=svc(); const IT=ACCOUNTS.it
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:1000}})
const page=await ctx.newPage(); const errs=trackErrors(page)
const net=[]; page.on('response', async r=>{ if(r.url().includes('8787')) net.push(r.request().method()+' '+new URL(r.url()).pathname+' -> '+r.status()+' '+(await r.text().catch(()=>'')).slice(0,300)) })
await login(page, IT.email, IT.password); await page.waitForTimeout(2000)
const REMAIN=['Disable SSO account','Collect company laptop','Collect access card']
for(const title of REMAIN){
  await page.goto(APP+'/it/approvals',{waitUntil:'networkidle'}); await page.waitForTimeout(1800)
  // identity-scoped: only rows inside the "Ishaan Nair" group header block
  const info = await page.evaluate((t)=>{
    const rows=[...document.querySelectorAll('.row')]
    const i=rows.findIndex(r=>r.dataset.groupHeader==='true' && r.innerText.includes('Ishaan Nair'))
    if(i<0) return {err:'no Ishaan Nair group'}
    const hits=[]
    for(let k=i+1;k<rows.length;k++){ if(rows[k].dataset.groupHeader==='true') break
      if(rows[k].innerText.split('\n')[0].trim()===t) hits.push(k) }
    return {i, hits}
  }, title)
  if(info.err || info.hits.length!==1){ console.log('SCOPE FAIL', title, j(info)); continue }
  const h = await page.evaluateHandle((args)=>{
    const rows=[...document.querySelectorAll('.row')]
    return rows[args.k].querySelector('button')
  }, {k: info.hits[0]})
  const el = h.asElement()
  const txt = await el.evaluate(n=>n.closest('.row').innerText.replace(/\n/g,' ~ '))
  console.log('scoped row ->', txt)
  if(!txt.startsWith(title)){ console.log('ABORT mismatch'); continue }
  await el.click(); await page.waitForTimeout(8000)
  const {data}=await db.from('exit_tasks').select('status').eq('case_id',caseId).eq('title',title).single()
  console.log('IT approved:',title,'-> db',data?.status)
}
await page.goto(APP+'/it/deprovisioning',{waitUntil:'networkidle'}); await page.waitForTimeout(2500)
await page.screenshot({path:SH+'b16_it_deprovisioning_after.png', fullPage:true})
const dep = await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.row')]
  const i=rows.findIndex(r=>r.dataset.groupHeader==='true' && r.innerText.includes('Ishaan Nair'))
  if(i<0) return {found:false}
  const out=[rows[i].innerText.replace(/\n/g,' ~ ')]
  for(let k=i+1;k<rows.length;k++){ if(rows[k].dataset.groupHeader==='true') break; out.push(rows[k].innerText.replace(/\n/g,' ~ ')) }
  return out
})
console.log('IT deprovisioning after:', j(dep))
await page.goto(APP+'/it/approvals',{waitUntil:'networkidle'}); await page.waitForTimeout(1500)
await page.screenshot({path:SH+'b17_it_approvals_final.png', fullPage:true})
console.log('NET:', j(net))
const {data:ar}=await db.from('agent_runs').select('agent,stage,detail,created_at').eq('case_id',caseId).order('created_at')
console.log('AGENT_RUNS n=',ar.length); for(const r of ar) console.log('  ',r.agent,'/',r.stage,'::',String(r.detail).slice(0,170))
const {data:t2}=await db.from('exit_tasks').select('stage,title,status').eq('case_id',caseId).order('stage')
for(const t of t2) console.log('TASK',t.stage,'|',t.status,'|',t.title)
const {data:cc}=await db.from('compliance_checks').select('item,status,failure_reason,evidence').eq('case_id',caseId).order('item')
console.log('COMPLIANCE:', j(cc))
const {data:cs}=await db.from('exit_cases').select('status,finance_cleared,risk_level,risk_score').eq('id',caseId).single()
console.log('CASE:', j(cs))
console.log('CONSOLE ERRORS:', j(errs))
await b.close()
