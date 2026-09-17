import { chromium } from 'playwright'
import { login, ACCOUNTS, trackErrors, j, APP } from './lib.mjs'
const SH='scripts/_review/shots/'
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:1200}})
const page=await ctx.newPage(); const errs=trackErrors(page)
await login(page, ACCOUNTS.hr.email, ACCOUNTS.hr.password); await page.waitForTimeout(2000)
await page.goto(APP+'/hr/agent-activity',{waitUntil:'networkidle'}); await page.waitForTimeout(3000)
const blk=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.row')]
  const idx=[]; rows.forEach((r,i)=>{ if(r.dataset.groupHeader==='true'&&r.innerText.includes('Ishaan Nair')) idx.push(i) })
  const out=[]
  for(const i of idx){ const g=[rows[i].innerText.replace(/\n/g,' ~ ')]
    for(let k=i+1;k<rows.length;k++){ if(rows[k].dataset.groupHeader==='true') break; g.push('   '+rows[k].innerText.replace(/\n/g,' ~ ')) }
    out.push(g) }
  return out
})
console.log('agent-activity Ishaan Nair groups:', j(blk))
await page.screenshot({path:SH+'b27_hr_agentactivity_full.png', fullPage:true})
// HR all-exits
await page.goto(APP+'/hr/all-exits',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
const r=page.locator('.row',{hasText:'Ishaan Nair'})
console.log('all-exits rows:', await r.count()); for(const t of await r.allInnerTexts()) console.log('  |',t.replace(/\n/g,' ~ '))
await page.screenshot({path:SH+'b28_hr_allexits.png', fullPage:true})
// HR risk & compliance
await page.goto(APP+'/hr/risk-and-compliance',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
const r2=page.locator('.row',{hasText:'Ishaan Nair'})
console.log('risk rows:', await r2.count()); for(const t of await r2.allInnerTexts()) console.log('  |',t.replace(/\n/g,' ~ '))
await page.screenshot({path:SH+'b29_hr_risk.png', fullPage:true})
console.log('ERRORS:', j(errs))
await b.close()
