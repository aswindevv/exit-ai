import fs from 'fs'
import { chromium } from 'playwright'
import { svc, login, trackErrors, employee, ACCOUNTS, j, APP } from './lib.mjs'
const SH='scripts/_review/shots/'
const { caseId } = JSON.parse(fs.readFileSync('scripts/_review/b_state.json','utf8'))
const db=svc(); const E=employee('Emp030')
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:1100}})
const page=await ctx.newPage(); const errs=trackErrors(page)
await login(page, E.email, E.password); await page.waitForTimeout(3000)
console.log('emp url:', page.url())
await page.screenshot({path:SH+'b24_emp030_final_dashboard.png', fullPage:true})
const body=await page.locator('body').innerText()
console.log('--- dashboard text ---'); console.log(body.slice(0,1800))
console.log('has exit-complete marker:', /exit is complete|Exit complete|relieving letter/i.test(body))
const nodes=await page.evaluate(()=>[...document.querySelectorAll('[data-stage-state]')].map(n=>n.innerText.replace(/\n/g,' ~ ')+' ['+n.dataset.stageState+']'))
console.log('timeline nodes:', j(nodes))
await page.goto(APP+'/employee/my-exit',{waitUntil:'networkidle'}); await page.waitForTimeout(2000)
await page.screenshot({path:SH+'b25_emp030_myexit.png', fullPage:true})
console.log('--- my-exit ---'); console.log((await page.locator('body').innerText()).slice(0,1200))
await page.goto(APP+'/employee/tasks',{waitUntil:'networkidle'}); await page.waitForTimeout(1500)
await page.screenshot({path:SH+'b26_emp030_tasks_final.png', fullPage:true})
console.log('CONSOLE ERRORS:', j(errs))
await b.close()
