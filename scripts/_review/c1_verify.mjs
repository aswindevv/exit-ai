import { svc, j } from './lib.mjs'
const CASE='36148438-4dc0-4741-a37f-d8ddc74713ad'
const db=svc()
const { data: c } = await db.from('exit_cases').select('*').eq('id',CASE).single()
console.log('CASE:', j({employee_id:c.employee_id,status:c.status,risk_level:c.risk_level,risk_score:c.risk_score,rehire_eligible:c.rehire_eligible,finance_cleared:c.finance_cleared,relieving_letter_issued:c.relieving_letter_issued}))
const { data: t } = await db.from('exit_tasks').select('stage,title,status,kt_event_id').eq('case_id',CASE)
const by={}; for(const r of t){by[r.stage]=by[r.stage]||[];by[r.stage].push(`${r.status}${r.kt_event_id?' [cal]':''} ${r.title}`)}
console.log('TASKS ('+t.length+'):', j(by))
const { data: ar } = await db.from('agent_runs').select('stage,agent,status,detail,created_at').eq('case_id',CASE).order('created_at')
const cnt={}; for(const r of ar) cnt[r.stage]=(cnt[r.stage]||0)+1
console.log('AGENT_RUNS ('+ar.length+') by stage:', j(cnt))
console.log('email rows:', j(ar.filter(r=>r.stage&&String(r.stage).includes('email')||String(r.detail||'').includes('email_drafting')).map(r=>r.stage+' | '+r.status+' | '+r.detail)))
console.log('it_deprov audit rows:', j(ar.filter(r=>r.stage==='it_deprovisioning_execution').map(r=>r.status+' :: '+r.detail)))
const { data: cc } = await db.from('compliance_checks').select('item,status,source,evidence').eq('case_id',CASE)
console.log('COMPLIANCE_CHECKS ('+cc.length+'):', j(cc))
const { data: ei } = await db.from('exit_interviews').select('*').eq('case_id',CASE)
console.log('EXIT_INTERVIEWS ('+ei.length+'):', j(ei.map(r=>({sentiment:r.sentiment,themes:r.themes,summary:(r.summary||'').slice(0,90)+'...',rehire_eligible:r.rehire_eligible}))))
const { data: kr } = await db.from('kt_reviews').select('*').eq('case_id',CASE)
console.log('KT_REVIEWS ('+kr.length+'):', j(kr.map(r=>({complete:r.complete,gaps:Array.isArray(r.gaps)?r.gaps.length:r.gaps,summary:(r.summary||'').slice(0,80)+'...'}))))
const { data: cd } = await db.from('case_documents').select('doc_type,status,validation_detail,file_path').eq('case_id',CASE)
console.log('CASE_DOCUMENTS ('+cd.length+'):', j(cd))
const { data: rpc } = await db.rpc('exit_case_cleared_for_relieving', { p_case_id: CASE })
console.log('rpc cleared_for_relieving:', rpc)
