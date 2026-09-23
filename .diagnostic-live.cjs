const fs = require('fs')
const { createClient } = require('@supabase/supabase-js')

function readEnv() {
  const out = {}
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[m[1]] = value
  }
  return out
}

const countBy = (rows, key) => Object.fromEntries([...rows.reduce((m, r) => m.set(String(r[key]), (m.get(String(r[key])) || 0) + 1), new Map())].sort())
const dupCount = (rows, keyOf) => [...rows.reduce((m, r) => { const k = keyOf(r); m.set(k, (m.get(k) || 0) + 1); return m }, new Map()).values()].filter((n) => n > 1).length
const isoFuture = (value) => value && Date.parse(value) > Date.now() + 5 * 60 * 1000
const publicError = (error) => error ? { code: error.code || null, status: error.status || null, message: String(error.message || error).replace(/https?:\/\/\S+/g, '<url>').slice(0, 180) } : null

async function read(admin, table, columns = '*') {
  const { data, error } = await admin.from(table).select(columns)
  return { rows: data || [], error: publicError(error) }
}

async function main() {
  const env = readEnv()
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  const tableSpecs = {
    profiles: 'id,role,email,employee_id,department,created_at,out_of_office',
    exit_cases: 'id,employee_id,manager_id,hr_id,last_working_day,status,risk_level,risk_score,rehire_eligible,created_at,finance_cleared,dues_note,relieving_letter_issued,issued_at,issued_by,finance_rejected',
    exit_tasks: 'id,case_id,stage,title,status,due_date,created_at,kt_event_id,reason,escalation_state',
    agent_runs: 'id,case_id,stage,detail,created_at,agent,status,metadata',
    kt_reviews: 'id,case_id,summary,gaps,complete,created_at',
    compliance_checks: 'id,case_id,item,status,source,evidence,failure_reason,checked_at',
    case_documents: 'id,case_id,doc_type,file_path,status,validation_detail,created_at',
    exit_interviews: 'id,case_id,summary,sentiment,themes,rehire_eligible,rehire_reason,reason_for_leaving,feedback,would_recommend,comments,created_at',
    trend_alerts: 'id,theme,department,severity,detail,created_at',
    analytics_insights: 'id,narrative,stats,agent_type,created_at',
  }
  const all = {}
  for (const [table, cols] of Object.entries(tableSpecs)) all[table] = await read(admin, table, cols)

  const docsCountResult = await admin.from('exit_docs').select('id,source,section', { count: 'exact' })
  const docs = docsCountResult.data || []
  const p = all.profiles.rows
  const c = all.exit_cases.rows
  const t = all.exit_tasks.rows
  const ar = all.agent_runs.rows
  const kr = all.kt_reviews.rows
  const cc = all.compliance_checks.rows
  const cd = all.case_documents.rows
  const ei = all.exit_interviews.rows
  const ta = all.trend_alerts.rows
  const ai = all.analytics_insights.rows

  const caseIds = new Set(c.map((x) => x.id))
  const profileIds = new Set(p.map((x) => x.id))
  const employeeIds = new Set(p.map((x) => x.employee_id).filter(Boolean))
  const tasksByCase = new Map()
  for (const row of t) {
    if (!tasksByCase.has(row.case_id)) tasksByCase.set(row.case_id, [])
    tasksByCase.get(row.case_id).push(row)
  }
  const required = ['hr', 'manager', 'it', 'compliance', 'finance']
  const caseStageSummary = c.map((row) => {
    const rows = tasksByCase.get(row.id) || []
    const missing = required.filter((s) => !rows.some((x) => x.stage === s))
    const pending = rows.filter((x) => x.status !== 'done')
    const compliance = rows.filter((x) => x.stage === 'compliance')
    const finance = rows.filter((x) => x.stage === 'finance')
    return { row, rows, missing, pending, compliance, finance }
  })

  const latestIt = new Map()
  for (const row of ar.filter((x) => x.stage === 'it_deprovisioning_execution' && x.metadata?.task_id)) {
    const prev = latestIt.get(row.metadata.task_id)
    if (!prev || Date.parse(row.created_at) > Date.parse(prev.created_at)) latestIt.set(row.metadata.task_id, row)
  }

  const integrity = {
    tableCounts: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.error ? `ERROR ${v.error.code || ''}`.trim() : v.rows.length])),
    liveColumns: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.rows[0] ? Object.keys(v.rows[0]).sort() : []])),
    roles: countBy(p, 'role'),
    casesByStatus: countBy(c, 'status'),
    tasksByStage: countBy(t, 'stage'),
    tasksByStatus: countBy(t, 'status'),
    agentRunsByStage: countBy(ar, 'stage'),
    agentRunsByStatus: countBy(ar.filter((x) => x.status != null), 'status'),
    analyticsByType: countBy(ai, 'agent_type'),
    documentsByStatus: countBy(cd, 'status'),
    complianceByStatus: countBy(cc, 'status'),
    interviewSentiments: countBy(ei.filter((x) => x.sentiment != null), 'sentiment'),
    duplicateCaseEmployees: dupCount(c, (x) => x.employee_id),
    duplicateTaskKeys: dupCount(t, (x) => `${x.case_id}|${x.stage}|${x.title}`),
    duplicateKtReviewCases: dupCount(kr, (x) => x.case_id),
    duplicateInterviewCases: dupCount(ei, (x) => x.case_id),
    orphanCasesEmployee: c.filter((x) => !employeeIds.has(x.employee_id)).length,
    orphanCaseManager: c.filter((x) => x.manager_id && !profileIds.has(x.manager_id)).length,
    orphanCaseHr: c.filter((x) => x.hr_id && !profileIds.has(x.hr_id)).length,
    orphanTasks: t.filter((x) => !caseIds.has(x.case_id)).length,
    orphanRuns: ar.filter((x) => !caseIds.has(x.case_id)).length,
    orphanKtReviews: kr.filter((x) => !caseIds.has(x.case_id)).length,
    orphanComplianceChecks: cc.filter((x) => !caseIds.has(x.case_id)).length,
    orphanDocuments: cd.filter((x) => !caseIds.has(x.case_id)).length,
    orphanInterviews: ei.filter((x) => !caseIds.has(x.case_id)).length,
    casesMissingManager: c.filter((x) => !x.manager_id).length,
    casesMissingHr: c.filter((x) => !x.hr_id).length,
    casesMissingRisk: c.filter((x) => x.risk_level == null || x.risk_score == null).length,
    casesMissingRehire: c.filter((x) => x.rehire_eligible == null).length,
    casesMissingAnyRequiredStage: caseStageSummary.filter((x) => x.missing.length).length,
    completedMissingStage: caseStageSummary.filter((x) => x.row.status === 'completed' && x.missing.length).length,
    completedWithPendingTask: caseStageSummary.filter((x) => x.row.status === 'completed' && x.pending.length).length,
    completedWithoutLetter: c.filter((x) => x.status === 'completed' && !x.relieving_letter_issued).length,
    letterWithoutCompleted: c.filter((x) => x.relieving_letter_issued && x.status !== 'completed').length,
    lettersWithComplianceNotDone: caseStageSummary.filter((x) => x.row.relieving_letter_issued && (!x.compliance.length || x.compliance.some((r) => r.status !== 'done'))).length,
    financeFlagAndRejectBothTrue: c.filter((x) => x.finance_cleared && x.finance_rejected).length,
    financeTaskDoneButFlagFalse: caseStageSummary.filter((x) => x.finance.some((r) => r.status === 'done') && !x.row.finance_cleared).length,
    activeAllRequiredTasksDone: caseStageSummary.filter((x) => x.row.status !== 'completed' && !x.missing.length && x.pending.length === 0).length,
    tasksMissingDueDate: t.filter((x) => !x.due_date).length,
    taskUnknownStage: t.filter((x) => !required.includes(x.stage)).length,
    taskUnknownStatus: t.filter((x) => !['pending', 'done'].includes(x.status)).length,
    futureTimestamps: [c, t, ar, kr, cd, ei, ta, ai].flat().filter((x) => isoFuture(x.created_at)).length,
    escalationStates: countBy(t.filter((x) => x.title?.startsWith('Escalated')), 'escalation_state'),
    openEscalationDuplicateCases: dupCount(t.filter((x) => x.title?.startsWith('Escalated') && (x.escalation_state || 'open') === 'open'), (x) => x.case_id),
    itExecutionStatuses: countBy([...latestIt.values()], 'status'),
    itDoneWithLatestVerificationFailed: t.filter((x) => x.stage === 'it' && x.status === 'done' && latestIt.get(x.id)?.status === 'verification_failed').length,
    itDoneWithoutVerifiedAudit: t.filter((x) => x.stage === 'it' && x.status === 'done' && latestIt.get(x.id)?.status !== 'verified').length,
    interviewsRawButNoAnalysis: ei.filter((x) => x.reason_for_leaving && (!x.summary || !x.sentiment)).length,
    interviewsAnalyzed: ei.filter((x) => x.summary && x.sentiment).length,
    documentsWithValidationDetail: cd.filter((x) => x.validation_detail).length,
    documentsMissingStoragePath: cd.filter((x) => !x.file_path).length,
    llmTraceRowsWithModelOrTokens: ar.filter((x) => x.metadata && (x.metadata.model || x.metadata.tokens || x.metadata.usage)).length,
    emailRunStatuses: countBy(ar.filter((x) => x.stage === 'email_drafting'), 'status'),
    ragDocumentCount: docsCountResult.count,
    ragSources: [...new Set(docs.map((x) => x.source))].sort(),
    tableErrors: Object.fromEntries(Object.entries(all).filter(([, v]) => v.error).map(([k, v]) => [k, v.error])),
    ragReadError: publicError(docsCountResult.error),
  }

  const bucketResult = await admin.storage.listBuckets()
  const bucket = (bucketResult.data || []).find((b) => b.id === 'exit-documents')
  let storage = { listBucketsError: publicError(bucketResult.error), exitDocumentsBucket: !!bucket, public: bucket?.public ?? null }
  if (bucket) {
    const rootList = await admin.storage.from('exit-documents').list('', { limit: 1000 })
    let objects = 0
    for (const item of rootList.data || []) {
      if (item.id) objects += 1
      else {
        const nested = await admin.storage.from('exit-documents').list(item.name, { limit: 1000 })
        objects += (nested.data || []).filter((x) => x.id).length
      }
    }
    storage.rootEntries = (rootList.data || []).length
    storage.objectCount = objects
    storage.error = publicError(rootList.error)
  }

  const pickProfiles = {
    employee: p.find((x) => x.role === 'employee' && c.some((row) => row.employee_id === x.employee_id)),
    manager: p.find((x) => x.id === c.find((row) => row.manager_id)?.manager_id) || p.find((x) => x.role === 'manager'),
    hr: p.find((x) => x.id === c.find((row) => row.hr_id)?.hr_id) || p.find((x) => x.role === 'hr'),
    it: p.find((x) => x.role === 'it'),
    finance: p.find((x) => x.role === 'finance'),
  }
  const passwordOf = (role, profile) => role === 'employee'
    ? `${profile.employee_id}${String.fromCharCode(64)}`
    : `${profile.email.split('@')[0]}${String.fromCharCode(64)}${role === 'hr' ? '1' : ''}`

  async function rlsFor(role, profile) {
    if (!profile) return { login: false, reason: 'no profile' }
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: loginError } = await client.auth.signInWithPassword({ email: profile.email, password: passwordOf(role, profile) })
    if (loginError) return { login: false, error: publicError(loginError) }
    const queries = {}
    for (const [name, table, cols] of [
      ['profiles', 'profiles', 'id,role,employee_id'],
      ['exitCasesBase', 'exit_cases', 'id,risk_level,risk_score,rehire_eligible'],
      ['employeeView', 'employee_exit_view', '*'],
      ['managerView', 'manager_case_view', '*'],
      ['itView', 'it_task_view', '*'],
      ['financeView', 'finance_case_view', '*'],
      ['tasks', 'exit_tasks', 'id,case_id,stage,status'],
      ['interviews', 'exit_interviews', 'id,case_id,summary,sentiment'],
      ['documents', 'case_documents', 'id,case_id,status'],
      ['runs', 'agent_runs', 'id,case_id,stage'],
      ['trends', 'trend_alerts', 'id'],
      ['insights', 'analytics_insights', 'id'],
      ['complianceChecks', 'compliance_checks', 'id'],
      ['ragDocs', 'exit_docs', 'id'],
    ]) {
      const res = await client.from(table).select(cols)
      queries[name] = { count: (res.data || []).length, error: publicError(res.error), stages: name === 'tasks' ? [...new Set((res.data || []).map((x) => x.stage))].sort() : undefined, columns: (res.data || [])[0] ? Object.keys(res.data[0]).sort() : undefined }
    }
    const otherCase = c.find((row) => role !== 'employee' || row.employee_id !== profile.employee_id)
    if (otherCase) {
      const other = await client.from('exit_tasks').select('id').eq('case_id', otherCase.id)
      queries.explicitOtherCaseTasks = { count: (other.data || []).length, error: publicError(other.error) }
    }
    const forbidden = await client.from(role === 'finance' ? 'finance_case_view' : role === 'it' ? 'it_task_view' : role === 'manager' ? 'manager_case_view' : 'employee_exit_view').select('risk_score')
    queries.forbiddenFieldProbe = { count: (forbidden.data || []).length, error: publicError(forbidden.error) }
    return { login: true, queries }
  }

  const rls = {}
  for (const [role, profile] of Object.entries(pickProfiles)) rls[role] = await rlsFor(role, profile)
  const anonChecks = {}
  for (const [name, table] of [['profiles', 'profiles'], ['exitCases', 'exit_cases'], ['tasks', 'exit_tasks'], ['ragDocs', 'exit_docs']]) {
    const res = await anon.from(table).select('id')
    anonChecks[name] = { count: (res.data || []).length, error: publicError(res.error) }
  }

  const beforeAsk = Date.now()
  const offTopic = await anon.functions.invoke('ask', { body: { question: 'What is the capital of France?' } })
  const askDurationMs = Date.now() - beforeAsk
  const invalidAsk = await anon.functions.invoke('ask', { body: {} })
  const unauthResign = await anon.functions.invoke('submit-resignation', { body: { last_working_day: '2030-01-01' } })
  const unauthForward = await anon.functions.invoke('forward-to-hr', { body: { question: 'Read-only authorization probe' } })
  const edge = {
    anonymousAsk: {
      success: !offTopic.error,
      durationMs: askDurationMs,
      refused: offTopic.data?.refused ?? null,
      general: offTopic.data?.general ?? null,
      sourceCount: offTopic.data?.sources?.length ?? null,
      error: publicError(offTopic.error),
    },
    invalidAsk: { success: !invalidAsk.error, dataError: invalidAsk.data?.error || null, error: publicError(invalidAsk.error) },
    anonymousResignation: { success: !unauthResign.error && !!unauthResign.data?.ok, dataError: unauthResign.data?.error || null, error: publicError(unauthResign.error) },
    anonymousForward: { success: !unauthForward.error && !!unauthForward.data?.ok, dataError: unauthForward.data?.error || null, error: publicError(unauthForward.error) },
  }

  process.stdout.write(`${JSON.stringify({ integrity, storage, rls, anonChecks, edge }, null, 2)}\n`)
}

main().catch((err) => {
  process.stderr.write(`${String(err.stack || err.message).replace(/https?:\/\/\S+/g, '<url>').slice(0, 1200)}\n`)
  process.exitCode = 1
})
