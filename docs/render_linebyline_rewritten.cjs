const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const root = path.resolve(__dirname, '..')
const htmlPath = path.join(__dirname, 'ExitAI_code_LineByLine_REWRITTEN.html')
const pdfPath = path.join(__dirname, 'ExitAI_code_LineByLine_REWRITTEN.pdf')

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const inline = (value) => esc(value).replaceAll('`', '')

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)
}

function codeRange(file, start, end, title, notes) {
  const lines = source(file)
  const actualEnd = Math.min(end, lines.length)
  const body = lines.slice(start - 1, actualEnd)
    .map((line, i) => `<span class="code-line"><span class="ln">${start + i}</span><span>${esc(line)}</span></span>`)
    .join('\n')
  return `
    <div class="code-block">
      <div class="code-title"><span>${esc(file)}</span><span>Lines ${start}–${actualEnd} · ${esc(title)}</span></div>
      <pre>${body}</pre>
      <div class="line-notes">${notes.map((n) => `<p>${n}</p>`).join('')}</div>
    </div>`
}

function table(headers, rows, cls = '') {
  return `<table class="${cls}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

function fileCard(file, purpose, calledBy, calls, output, status = '') {
  return `<div class="file-card">
    <h3>${esc(file)} ${status ? `<span class="badge">${esc(status)}</span>` : ''}</h3>
    <dl>
      <dt>PURPOSE</dt><dd>${purpose}</dd>
      <dt>CALLED BY</dt><dd>${calledBy}</dd>
      <dt>CALLS</dt><dd>${calls}</dd>
      <dt>OUTPUT</dt><dd>${output}</dd>
    </dl>
  </div>`
}

function agentCard(name, file, main, calledBy, input, processing, llm, db, output, next, live) {
  const rows = [
    ['File', `<code>${esc(file)}</code>`], ['Purpose', processing], ['Main function', `<code>${esc(main)}</code>`],
    ['Called by', calledBy], ['Calls', `<b>LLM:</b> ${llm}<br><b>Database:</b> ${db}`], ['Input', input], ['Processing', processing], ['LLM call', llm],
    ['Database operations', db], ['Output', output], ['Next step', next],
  ]
  return `<div class="agent-card"><h3>${esc(name)} <span class="badge ${live === 'Live browser' ? 'live' : ''}">${esc(live)}</span></h3>${table(['Field', 'Actual implementation'], rows)}</div>`
}

let h = `<!doctype html><html><head><meta charset="utf-8"><title>ExitAI Code — Line by Line (Rewritten)</title>
<style>
  :root{--ink:#14213d;--muted:#52606d;--blue:#0b5fff;--cyan:#0ea5a8;--pale:#eef5ff;--line:#d8e1ef;--code:#0d172a;--green:#087f5b;--amber:#9a6700;--red:#b42318}
  *{box-sizing:border-box} html{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  body{margin:0;color:var(--ink);font-family:Arial,"Helvetica Neue",sans-serif;font-size:9.4pt;line-height:1.42;background:#fff;max-width:100%;overflow-wrap:anywhere}
  @page{size:A4;margin:16mm 14mm 18mm} @page:first{margin:0}
  .cover{height:297mm;padding:31mm 24mm;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(145deg,#071b3a,#0b5fff 72%,#16a7bd);color:#fff;page-break-after:always}
  .cover .kicker{font-size:9pt;letter-spacing:2.2px;text-transform:uppercase;opacity:.8}.cover h1{font-size:34pt;line-height:1.08;margin:14px 0}.cover p{font-size:13pt;line-height:1.5;max-width:135mm}.cover .meta{margin-top:auto;font-size:9pt;opacity:.75}
  h1{font-size:21pt;color:var(--blue);margin:0 0 10px} h2{font-size:14.5pt;margin:20px 0 8px;color:#17375e;break-after:avoid-page} h3{font-size:10.5pt;margin:12px 0 6px;break-after:avoid-page}
  p{margin:5px 0 8px}.section{page-break-before:always}.section:first-of-type{page-break-before:auto}.eyebrow{display:inline-block;padding:3px 8px;background:var(--blue);color:#fff;font-size:7pt;font-weight:bold;letter-spacing:1.2px;border-radius:3px;margin-bottom:7px}
  code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:8.2pt;background:#eef2f7;padding:1px 3px;border-radius:3px}
  .flow{font-family:"SFMono-Regular",Consolas,monospace;background:#f5f9ff;border:1px solid #bdd3f7;border-left:5px solid var(--blue);padding:11px 14px;white-space:pre-wrap;line-height:1.55;margin:10px 0;break-inside:avoid-page}
  .note{padding:9px 11px;border-left:4px solid var(--cyan);background:#edfafa;margin:9px 0;break-inside:avoid-page}.warning{border-color:#e5a000;background:#fff8df}.truth{border-color:var(--red);background:#fff2f0}
  table{width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;margin:8px 0 13px;font-size:8.2pt}thead{display:table-header-group}tr{break-inside:avoid-page}th{background:#17375e;color:#fff;padding:6px;text-align:left;vertical-align:top}td{border:1px solid var(--line);padding:6px;vertical-align:top;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f7f9fc}.tight td{padding:4px 5px}
  .tree{font-family:"SFMono-Regular",Consolas,monospace;font-size:7.8pt;line-height:1.45;background:#f7f9fc;border:1px solid var(--line);padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}
  .file-card,.agent-card{border:1px solid var(--line);border-radius:7px;padding:9px 11px;margin:9px 0;break-inside:avoid-page}.file-card h3,.agent-card h3{margin-top:0;color:#17375e}.file-card dl{display:grid;grid-template-columns:22mm 1fr;margin:0}.file-card dt{font-weight:bold;color:var(--blue);font-size:7.2pt;padding:2px 0}.file-card dd{margin:0;padding:2px 0}
  .badge{display:inline-block;font-size:6.5pt;line-height:1.2;padding:2px 6px;border-radius:9px;background:#fff0c2;color:#785600;margin-left:5px;vertical-align:middle}.badge.live{background:#d8f7ea;color:#056146}
  .code-block{border:1px solid #aebdd2;border-radius:6px;margin:12px 0 18px;break-inside:auto;min-width:0;max-width:100%;overflow:hidden}.code-title{display:flex;justify-content:space-between;gap:10px;background:#dce9ff;color:#17375e;padding:6px 9px;font-size:7.7pt;font-weight:bold;break-after:avoid-page;overflow-wrap:anywhere}
  pre{margin:0;max-width:100%;background:var(--code);color:#e8eef9;padding:8px 0;font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:6.6pt;line-height:1.34;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;tab-size:2}.code-line{display:grid;grid-template-columns:9mm minmax(0,1fr);padding-right:7px;max-width:100%}.code-line>span:last-child{min-width:0;overflow-wrap:anywhere;word-break:break-word}.ln{color:#71809a;text-align:right;padding-right:7px;user-select:none}.line-notes{padding:8px 10px;background:#fbfcfe}.line-notes p{font-size:8.4pt;margin:4px 0}.line-notes b{color:var(--blue)}
  .toc{columns:2;column-gap:18mm}.toc p{break-inside:avoid;margin:5px 0}.small{font-size:8pt;color:var(--muted)}.mono{font-family:"SFMono-Regular",Consolas,monospace}.keep{break-inside:avoid-page}.page-break{page-break-before:always}
</style></head><body>
<section class="cover"><div class="kicker">ExitAI · verified code walkthrough</div><h1>Code Line by Line<br>Rewritten</h1><p>How the current code starts, routes requests, advances an exit case, runs agents, retrieves policy context, and persists state.</p><div class="meta">Source material: docs/ExitAI_Code_LineByLine.pdf<br>Verified against repository files on 22 September 2026</div></section>

<section><span class="eyebrow">READING GUIDE</span><h1>Scope and notation</h1>
<p>This rewrite follows the source PDF but resolves every path against the current repository. It explains code behavior only. It deliberately omits project planning, deployment guidance, business justification, and generic AI theory.</p>
<div class="note truth"><b>Two execution models exist.</b> The live browser does <em>not</em> invoke <code>agents/hub/supervisor.py</code>. Browser actions call Supabase directly, call three Edge Functions, and use <code>agents/service.py</code> for Python-only work. The supervisor is used by the CLI and test/capstone runners.</div>
<div class="toc"><p><b>1.</b> Actual code structure</p><p><b>2.</b> How the code starts</p><p><b>3.</b> Complete browser lifecycle</p><p><b>4.</b> Agent structure and live status</p><p><b>5.</b> Supervisor / hub state machine</p><p><b>6.</b> Service and API code</p><p><b>7.</b> RAG code path</p><p><b>8.</b> Database flow</p><p><b>9.</b> Line-by-line source walkthrough</p></div>
</section>

<section class="section"><span class="eyebrow">SECTION 1</span><h1>Actual code structure</h1>
<pre class="tree">project/
├── agents/
│   ├── core/                  config, LLM gateway, prompts, tracing, email, calendar
│   ├── hub/
│   │   ├── supervisor.py      CLI LangGraph pipeline
│   │   └── e2e_automation.py  standalone capstone graph
│   ├── spokes/                operational agents and thin compatibility wrappers
│   ├── analytics/             manually-run aggregate agents
│   ├── service.py             local browser-to-Python bridge on port 8787
│   └── run_case.py            CLI wrapper around supervisor.run_case
├── src/
│   ├── main.jsx               React mount
│   ├── App.jsx                auth and role lookup
│   ├── routes/                employee, manager, IT, finance, HR pages/layouts
│   ├── components/            shared UI
│   ├── lib/                   Supabase client and derived-state helpers
│   └── styles/                UI styling only
├── supabase/
│   ├── functions/
│   │   ├── submit-resignation/index.ts
│   │   ├── ask/index.ts
│   │   └── forward-to-hr/index.ts
│   └── migrations/            schema, RLS, views, RPCs, later columns
├── scripts/
│   ├── exit_policy.md         RAG source document
│   ├── ingest_docs.js         RAG ingestion
│   ├── seed/                  demo data
│   └── verify/                browser/DB/agent verification scripts
├── prompts/                   system prompts loaded by Python agents
└── docs/                      documentation and PDF renderers</pre>
<p class="small">Excluded from detailed treatment: empty <code>__init__.py</code> files, CSS, generated PDFs, images, one-time OAuth setup, seed data, and verification scripts. They do not define the runtime flow explained here.</p>

<h2>Frontend and API files</h2>
${fileCard('src/main.jsx','Mounts React and imports global CSS.','The browser loads index.html.','createRoot(...).render(<App />).','A mounted React component tree.')}
${fileCard('src/App.jsx','Resolves the Supabase session and profiles.role, then chooses the authenticated dashboard.','src/main.jsx.','supabase.auth, profiles, AppRoutes.','LoginPage or role-scoped routes.')}
${fileCard('src/routes/AppRoutes.jsx','Maps URLs to role-guarded layouts/pages.','App.','Employee/Manager/IT/Finance/HR route modules.','The selected page or a redirect.')}
${fileCard('src/routes/employee/EmployeePages.jsx','Implements resignation, employee tasks, policy Q&A, uploads, and exit interview submission.','Employee routes.','submit-resignation, ask, forward-to-hr, Supabase tables/storage, local service.','Database writes plus rendered employee state.','Live browser')}
${fileCard('src/routes/manager/ManagerPages.jsx','Approves or rejects manager-stage KT tasks and triggers the manager gate handoff.','Manager routes.','exit_tasks and /manager-approve or /reject-manager-task.','Task status, escalation, or IT-stage advancement.','Live browser')}
${fileCard('src/routes/it/ItPages.jsx','Approves IT tasks and triggers execution/verification.','IT routes.','exit_tasks and /execute-deprovisioning.','Done task plus agent_runs verification audit.','Live browser')}
${fileCard('src/routes/finance/FinancePages.jsx','Settles or rejects dues.','Finance routes.','finance RPCs and /finance-settle-check.','finance_cleared/dues_note and recalculated finance/compliance/risk.','Live browser')}
${fileCard('src/routes/hr/HrPages.jsx','Handles escalation transitions and final relieving-letter issue.','HR routes.','exit_tasks, exit_cases, /escalation-audit, /issue-relieving-letter.','Resolved/rerouted escalation or completed case.','Live browser')}
${fileCard('supabase/functions/submit-resignation/index.ts','Authenticates the employee and creates one exit_cases row.','EmployeePages.Resignation.handleSubmit.','Supabase Auth, profiles, exit_cases.','{ ok, case } JSON.','Live browser')}
${fileCard('supabase/functions/ask/index.ts','Embeds a question, retrieves policy chunks, asks the LLM, and builds citations.','EmployeePages.Dashboard.handleAsk.','embedding gateway, match_exit_docs RPC, message gateway.','{ answer, sources, refused, general } JSON.','Live browser')}
${fileCard('supabase/functions/forward-to-hr/index.ts','Emails an explicitly forwarded unanswered question; logs failed delivery.','EmployeePages.Dashboard.handleForward.','Supabase Auth/profiles, SMTP, exit_cases, agent_runs.','Immediate or delayed-success JSON.','Live browser')}

<h2>Python runtime files</h2>
${fileCard('agents/service.py','Exposes nine localhost POST routes for browser-triggered Python work.','Browser fetch calls.','Operational agents, db, trace logger.','JSON responses and agent/database side effects.','Live browser')}
${fileCard('agents/hub/supervisor.py','Builds the ordered LangGraph used for a complete simulated case run.','run_case.py, e2e_automation.py, tests, direct module execution.','Checklist/KT/IT/compliance/finance/risk/routing agents.','Final SupervisorState and persisted agent_runs/tasks.','CLI/test, not live browser')}
${fileCard('agents/run_case.py','Parses CLI arguments and invokes supervisor.run_case.','python -m agents.run_case.','agents.hub.supervisor.run_case.','Trace output and final log.','CLI only')}
${fileCard('agents/hub/e2e_automation.py','Composes initiation, supervisor, per-case SLA scan, and finalization.','Direct module execution/tests.','service.activate_case, supervisor.run_case, sla_escalation.','Completed/blocked outcome and audit row.','Standalone; not live browser')}
${fileCard('agents/core/config.py','Loads environment values and constructs the shared service-role Supabase client.','All Python modules that import db/config constants.','dotenv, create_client.','Module constants and db client.')}
${fileCard('agents/core/llm.py','Makes every Python LLM request and optionally parses JSON.','LLM-backed spokes and analytics agents.','Portkey/Anthropic-compatible /v1/messages.','Text or dict.')}
${fileCard('agents/core/prompts.py','Reads prompt markdown from prompts/.','LLM-backed agents at import time.','Path.read_text.','Prompt string.')}
${fileCard('agents/core/trace.py','Wraps graph nodes and logs LLM/DB timing.','@traced_node and explicit log_llm/log_db calls.','stdout only.','Trace lines; no workflow state change.')}
${fileCard('agents/core/notifications.py','Builds and sends/logs email templates.','email_drafting_agent and manual overdue scan.','profiles, exit_tasks, exit_cases, Gmail SMTP.','Per-recipient delivery dictionaries.')}
${fileCard('agents/core/calendar_booking.py','Creates KT calendar events when configured.','hr_agent._persist_checklist.','Google Calendar API, exit_tasks.','Event result and kt_event_id update.')}

<h2>Data and RAG files</h2>
${fileCard('scripts/ingest_docs.js','Chunks scripts/exit_policy.md, embeds chunks, replaces rows for that source.','Manual node scripts/ingest_docs.js.','Portkey embeddings, exit_docs.','Fresh vector rows.')}
${fileCard('supabase/migrations/0001_schema.sql','Creates core tables and pgvector index.','Supabase migration runner.','PostgreSQL/pgvector.','profiles, exit_cases, exit_tasks, exit_interviews, trend_alerts, exit_docs.')}
${fileCard('supabase/migrations/0002_rls.sql','Enables RLS and defines role-specific policies/views.','Supabase migration runner.','auth.uid(), profiles role helper.','Database-enforced row access.')}
${fileCard('supabase/migrations/0003_rag.sql','Defines cosine-similarity RPC for policy chunks.','ask Edge Function through db.rpc.','exit_docs and pgvector <=>.','Top matching chunks with similarity.')}
</section>

<section class="section"><span class="eyebrow">SECTION 2</span><h1>How the code starts</h1>
<h2>Browser startup</h2>
<div class="flow">index.html #root
  ↓ src/main.jsx · createRoot(...).render(&lt;App /&gt;)
  ↓ src/App.jsx · App()
  ↓ supabase.auth.getSession() + profiles.role
  ↓ src/routes/AppRoutes.jsx · AppRoutes({ role, session })
  ↓ role layout loads rows through RLS-scoped Supabase client
  ↓ page action invokes Edge Function, RPC, direct table update, or localhost:8787
  ↓ layout reload() reads fresh rows and React re-renders</div>
<p><code>src/lib/supabase.js</code> supplies one anon-key client. Browser identity comes from its session JWT. Database RLS—not the JSX route guard—is the data boundary.</p>

<h2>Browser resignation entry</h2>
<div class="flow">src/routes/employee/EmployeePages.jsx · Resignation.handleSubmit
  ↓ supabase.functions.invoke('submit-resignation')
  ↓ supabase/functions/submit-resignation/index.ts · Deno.serve handler
  ↓ Auth getUser → profiles lookup → exit_cases insert/return existing
  ↓ browser POST http://localhost:8787/activate-exit
  ↓ agents/service.py · Handler.do_POST → activate_case
  ↓ hr_agent.generate_checklist → exit_tasks(hr, manager)
  ↓ email_drafting_agent.resignation_notice → notifications
  ↓ exit_cases.status = in_progress
  ↓ JSON response; browser navigates to /employee</div>

<h2>CLI entry</h2>
<div class="flow">python -m agents.run_case CASE_ID [--reject] [--kt-text FILE] [--interview-text FILE]
  ↓ agents/run_case.py · _read() and __main__ block
  ↓ agents/hub/supervisor.py · run_case(...)
  ↓ supervisor_graph.invoke(initial SupervisorState)
  ↓ hr → manager_gate → approved: it → compliance → finance → assess
                         rejected: escalate → END
  ↓ final SupervisorState printed with elapsed time</div>
<div class="note warning"><b>The CLI gate is simulated.</b> <code>simulate_rejection</code> selects the branch. It does not wait for a manager’s browser action or inspect manager task status.</div>

<h2>Standalone capstone entry</h2>
<div class="flow">python -m agents.hub.e2e_automation CASE_ID [--reject]
  ↓ _initiate → service.activate_case
  ↓ _coordinate → supervisor.run_case
  ↓ _sla_check → sla_escalation.find_breaches + _escalate
  ↓ _finalize → read compliance/finance task rows
  ↓ exit_cases.status completed only when both rows are done</div>
<p>This is not the browser route. It is an explicit all-in-one runner.</p>
</section>

<section class="section"><span class="eyebrow">SECTION 3</span><h1>Complete live browser lifecycle</h1>
<div class="flow">Employee resignation
  ↓ HR checklist generation / employee completion
  ↓ Manager KT approval ── rejection → HR escalation
  ↓ IT plan and human IT approval
  ↓ execute / verify / audit + compliance re-check
  ↓ Finance dues decision
  ↓ finance task + compliance + risk re-check
  ↓ HR relieving-letter gate
  ↓ exit_cases.status = completed</div>
${table(['Transition','File / function','Input','What it does','Reads / writes','Next'],[
  ['Resign','<code>EmployeePages.jsx</code><br><code>Resignation.handleSubmit</code>','last working day, reason; session JWT','Calls Edge Function, then local activation service.','Edge Function writes <code>exit_cases</code>.','Employee dashboard.'],
  ['Activate','<code>agents/service.py</code><br><code>activate_case</code>','case_id','Generates HR/manager tasks, marks case in progress, sends manager notice.','Reads/writes <code>exit_cases</code>, writes <code>exit_tasks</code>/<code>agent_runs</code>.','Employee completes HR tasks; manager reviews KT.'],
  ['Employee task done','<code>EmployeePages.jsx</code><br><code>useMarkDone.markDone</code>','task id','Direct status=done update; RLS restricts to employee’s HR-stage tasks.','Writes <code>exit_tasks</code>.','Manager gate remains separate.'],
  ['Manager approval','<code>ManagerPages.jsx</code><br><code>useApprove</code> / <code>useSignClearance</code>','manager task/case id','Marks a KT task done, then service verifies all KT rows and creates IT plan.','Writes <code>exit_tasks</code>, <code>agent_runs</code>; reads case/tasks.','IT dashboard receives stage=it tasks.'],
  ['Manager rejection','<code>ManagerPages.jsx</code> → <code>service.reject_manager_task</code>','case_id, task_id, reason','Creates/reopens one manager escalation and logs it.','Writes <code>exit_tasks</code>, <code>agent_runs</code>.','Stops before IT until HR action.'],
  ['HR escalation action','<code>HrPages.jsx</code><br><code>useEscalationAction.act</code>','task, rerouted/resolved, actor','RLS update changes escalation_state; service appends audit and closes resolved task.','Writes <code>exit_tasks</code>, <code>agent_runs</code>.','Rerouted returns to manager; resolved removes blocker.'],
  ['IT approval','<code>ItPages.jsx</code><br><code>useApprove.approveTask</code>','IT task id and case id','Marks task done; runs MockITAdapter execute/verify/audit; reruns compliance.','Writes <code>exit_tasks</code>, <code>agent_runs</code>, compliance rows.','Finance can proceed when prior tasks are done.'],
  ['Document upload','<code>EmployeePages.jsx</code><br><code>Documents.handleUpload</code>','file and doc_type','Uploads to bucket, inserts metadata, triggers OCR validation and compliance.','Storage <code>exit-documents</code>; <code>case_documents</code>, compliance rows.','Validated NDA/asset form can satisfy compliance items.'],
  ['Exit interview','<code>EmployeePages.jsx</code><br><code>ExitInterview.handleSubmit</code>','reason, feedback, recommend, comments','Inserts raw answers, then LLM adds summary/sentiment/themes/rehire fields.','Writes <code>exit_interviews</code>.','Risk reads sentiment later.'],
  ['Finance settle','<code>FinancePages.jsx</code><br><code>useSettle.settle</code>','case_id, dues note','RPC sets finance flag; service recomputes finance, compliance, and risk.','Writes <code>exit_cases</code>, <code>exit_tasks</code>, <code>compliance_checks</code>, <code>agent_runs</code>.','HR final gate.'],
  ['Finance reject','<code>FinancePages.jsx</code><br><code>useReject.reject</code>','case_id, reason','RPC sets finance_cleared=false and records the reason.','Writes <code>exit_cases</code>.','Finance remains held; no Python endpoint runs.'],
  ['Relieving letter','<code>HrPages.jsx</code><br><code>useIssueRelievingLetter.issue</code>','case_id, HR user id','Direct update succeeds only through database gate; service sends notice.','Writes <code>exit_cases</code>; email attempt in <code>agent_runs</code>.','Case is completed.'],
])}
<div class="note"><b>Compliance is event-driven in the browser path.</b> It is rerun after manager advancement, document validation, IT execution, and finance settlement. It is not a free-running background process.</div>
</section>

<section class="section"><span class="eyebrow">SECTION 4</span><h1>Agent structure</h1>
<p>The “agent” label covers LangGraph subgraphs, deterministic evaluators, wrappers, and LLM-backed functions. The table below states exactly which kind each one is and whether the browser reaches it.</p>
${agentCard('Supervisor / Orchestrator (#1)','agents/hub/supervisor.py','run_case(case_id, ...)', 'agents/run_case.py; e2e_automation.py; tests; direct module execution','case_id, optional KT/interview text, simulate_rejection','LangGraph routes HR→manager gate and branches to IT or escalation, then compliance→finance→assess.','Only through delegated HR/IT/interview agents.','Activates exit_cases; delegated agents write tasks/checks/risk; _record inserts agent_runs.','Final SupervisorState with log.','Caller receives final state; no browser response uses it.','Not part of the live browser execution path')}
${agentCard('Checklist Generator (#5)','agents/spokes/checklist_generator_agent.py','generate(case_id, force=False)','service.activate_case; supervisor._hr_stage','case_id, optional force','Thin traced wrapper over hr_agent.generate_checklist.','Indirectly: hr_agent calls ask_claude_json.','hr_agent reads exit_cases and inserts exit_tasks.','Checklist graph result or skipped flag.','Employee/manager work the generated tasks.','Live browser')}
${agentCard('HR checklist / KT review (#2)','agents/spokes/hr_agent.py','generate_checklist; review_kt_document','Checklist wrapper; KT wrapper','case row or KT text','Two separate LangGraphs: generate→persist and review→persist.','ask_claude_json with hr/checklist_system.md or hr/kt_review_system.md.','Reads exit_cases/tasks; writes exit_tasks and kt_reviews; may update kt_event_id via calendar.','Graph state containing result.','Manager tasks form the human gate; KT gaps create neutral follow-up tasks.','Live browser for checklist; KT review CLI only')}
${agentCard('KT Document Reviewer (#10)','agents/spokes/kt_document_reviewer_agent.py','review(case_id, kt_text)','supervisor._hr_stage','case_id, raw KT text','Thin traced wrapper over hr_agent.review_kt_document.','Indirect LLM call in hr_agent.','Writes kt_reviews and possible manager tasks through hr_agent.','KT review graph result.','Supervisor proceeds to manager gate.','Not part of the live browser execution path')}
${agentCard('IT plan (#3)','agents/spokes/it_agent.py','generate_plan(case_id, force=False)','it_deprovisioning_agent.generate','case_id','Fetches case, generates task titles, inserts stage=it rows; skips existing rows.','ask_claude_json with it/deprovisioning_system.md.','Reads exit_cases/exit_tasks; inserts exit_tasks.','Graph state or skipped flag.','IT user approves tasks.','Live browser')}
${agentCard('Automated IT Deprovisioning (#18)','agents/spokes/it_deprovisioning_agent.py','generate; execute_approved_tasks','service.manager_approve; service.execute_deprovisioning; supervisor._it_stage','case_id','generate delegates to IT plan; execution classifies done tasks, calls MockITAdapter, independently verifies, and audits.','None.','Reads exit_tasks/agent_runs; inserts agent_runs.','Plan dict or list of execution records.','Compliance is rerun by service.','Live browser')}
${agentCard('Compliance Verification (#13)','agents/spokes/compliance_agent.py','run_for_case(case_id)','service event endpoints; supervisor._compliance_stage','case_id','check→persist→item-level graph; matches tasks/documents and explicit manager/finance signals.','None.','Reads tasks, validated docs, manager agent_runs, exit_cases.finance_cleared; updates/inserts exit_tasks; upserts compliance_checks.','{ result, items } graph state.','Browser waits for later events; CLI continues to finance.','Live browser')}
${agentCard('Finance (#4)','agents/spokes/finance_agent.py','check_clearance(case_id)','service.finance_settle_check; supervisor._finance_stage','case_id','Requires at least one prior-stage task, all prior tasks done, and finance_cleared=true.','None.','Reads exit_tasks/exit_cases; inserts or updates finance task; may send completion email.','Finance graph result.','Risk runs next in browser service; assess runs next in CLI.','Live browser')}
${agentCard('Compliance & Risk (#12)','agents/spokes/risk_agent.py','run_for_case(case_id)','service.finance_settle_check; supervisor._assess_stage','case_id','Scores tenure proxy, department criticality, interview sentiment, and incomplete tasks.','None.','Reads exit_cases, profiles, exit_interviews, exit_tasks; updates exit_cases; inserts agent_runs.','risk_score, risk_level, rehire_eligible.','HR reads assessment fields.','Live browser')}
${agentCard('Exit-Interview Intelligence (#8/#19)','agents/spokes/exit_intel_agent.py','run_per_case; run_longitudinal','service.submit_exit_interview; supervisor assess; manual module','case_id + transcript, or all interviews','Per-case analyze→persist; longitudinal counts repeated themes→trend alerts.','ask_claude_json for per-case only.','Reads/writes exit_interviews; longitudinal reads exit_cases and inserts trend_alerts.','Analysis state or rising themes.','Risk can consume sentiment; HR reads interviews/trends.','Live browser per-case; longitudinal manual only')}
${agentCard('Document Collection (#16)','agents/spokes/doc_collection.py','validate_one; run','service.validate_document; manual module/tests','case_id, document_id or case batch','Downloads Storage object, OCRs it, applies document-specific keywords/name/date rules.','None.','Reads exit_cases/case_documents and Storage; updates case_documents; inserts agent_runs.','Validation dict or batch graph state.','Service reruns compliance.','Live browser via validate_one')}
${agentCard('Smart Routing (#11)','agents/spokes/smart_routing.py','pick_approver(case_id, stage)','supervisor HR/manager/IT nodes','case_id and hr|manager|it','Prefers department match, skips out-of-office candidates, records choice.','None.','Reads exit_cases/profiles; writes agent_runs.','Decision dict.','Supervisor continues its edge.','Not part of the live browser execution path')}
${agentCard('Multi-System Clearance (#15)','agents/spokes/multi_system_clearance.py','consolidate(case_id)','supervisor._compliance_stage','case_id','Queries HRMS/ITAM/Finance stand-in adapters with timeout/retry, then consolidates status.','None.','Reads tasks/documents; writes agent_runs.','Per-system and overall status.','Supervisor proceeds to finance.','Not part of the live browser execution path')}
${agentCard('Email Drafting (#6)','agents/spokes/email_drafting_agent.py','template-specific wrapper functions','service, finance, SLA, doc collection','case/task/breach/template data','Calls notifications function, catches errors, normalizes outcomes, audits attempt.','None.','Writes agent_runs; notifications may read profiles.','Delivery result without crashing caller.','Caller continues regardless of SMTP outcome.','Live browser')}
${agentCard('Intelligent Rehire Assessment (#21)','agents/spokes/rehire_agent.py','assess(case_id)','Direct module/tests only','case_id','Reads already-computed case eligibility/risk and optional interview reason; formats recommendation.','None.','Reads exit_cases/exit_interviews; inserts agent_runs.','Assessment dict.','No automatic next step.','Not part of the live browser execution path')}

<h2>Analytics agents</h2>
${agentCard('Dashboard Analytics (#14)','agents/analytics/analytics_agent.py','run()','Direct module execution','No arguments; reads all cases/tasks','Aggregates counts in Python, then narrates the already-computed stats.','ask_claude with dashboard_insights_system.md.','Reads exit_cases/exit_tasks; inserts analytics_insights(agent_type=dashboard_insights).','Graph state with stats and narrative.','HR layout can read the newest stored row.','Not part of the live browser execution path')}
${agentCard('SLA Escalation (#9)','agents/analytics/sla_escalation.py','run(); find_breaches(...)','Direct module; e2e_automation reuses finder/_escalate','All pending tasks/cases/profiles, or preloaded lists for pure finder','Selects tasks at least five days overdue, resolves owner/impact, sends escalation notices.','None.','Reads exit_tasks/exit_cases/profiles; inserts agent_runs through escalation flow.','Breach list and escalation count.','No automatic scheduler; caller ends.','Not part of the live browser execution path')}
${agentCard('Exit Workflow Optimizer (#17)','agents/analytics/workflow_optimizer.py','run()','Direct module execution','No arguments; reads pending workflow data','Reuses SLA breach arithmetic and aggregates bottleneck counts.','ask_claude with workflow_optimizer_system.md.','Reads exit_tasks/exit_cases/profiles; inserts analytics_insights(workflow_optimizer).','Stats and narrative.','HR layout can read newest stored row.','Not part of the live browser execution path')}
${agentCard('Policy Compliance Auditor (#22)','agents/analytics/policy_auditor.py','run()','Direct module execution','No arguments; reads active cases/tasks/runs','Checks SLA breach, missing approval, and skipped-step conditions, then formats a report.','ask_claude only when breaches exist.','Reads exit_cases/exit_tasks/agent_runs; inserts analytics_insights(policy_compliance_auditor).','Report and narrative.','HR page reads stored narrative; live JS separately recomputes counts.','Not part of the live browser execution path')}
${agentCard('Predictive Attrition (#23)','agents/analytics/attrition_agent.py','run()','Direct module execution','No arguments; reads department-level signals','Combines average exit risk and trend-alert departments, counts current employees in signalled departments.','ask_claude only when signals exist.','Reads exit_cases/trend_alerts/profiles; inserts analytics_insights(predictive_attrition).','Signals and narrative.','No automatic next step.','Not part of the live browser execution path')}
${agentCard('End-to-End Exit Automation (#24)','agents/hub/e2e_automation.py','run(case_id, ...)','Direct module execution/tests','case_id, optional texts, simulate_rejection','Graph composes service activation, supervisor, case-scoped SLA check, and persisted-gate finalization.','Only through delegated agents.','Reads/writes operational tables through reused functions; may update exit_cases.status and insert agent_runs.','Final E2EState with initiation, pipeline, SLA, outcome.','Caller receives completed or blocked outcome.','Not part of the live browser execution path')}

<h2>Relationship by execution path</h2>
<div class="flow">LIVE BROWSER
submit-resignation Edge Function
  ↓ service.activate_case → Checklist/HR → Email Drafting
  ↓ human Manager gate
  ├─ reject → escalation → HR action
  └─ approve → IT plan → human IT approval → IT execute/verify/audit
                                           ↓ Compliance (rechecked)
  ↓ human Finance RPC → Finance → Compliance → Risk
  ↓ human HR relieving-letter update → Email Drafting

CLI SUPERVISOR
Supervisor → Checklist/HR + KT Review + Smart Routing
  ↓ simulated Manager gate
  ↓ IT plan + Smart Routing → Compliance + Multi-System Clearance
  ↓ Finance → Exit Interview (optional) → Risk</div>
</section>

<section class="section"><span class="eyebrow">SECTION 5</span><h1>Supervisor / hub code</h1>
${table(['Field','Actual implementation'],[
 ['File','<code>agents/hub/supervisor.py</code>'],['Function','<code>run_case(case_id, kt_text=None, interview_text=None, simulate_rejection=False)</code>'],
 ['Input','Case UUID plus optional KT/interview text and a simulated rejection flag.'],['State','<code>SupervisorState</code>: case_id, kt_text, interview_text, simulate_rejection, log.'],
 ['Routing logic','Entry is hr. A conditional edge after manager_gate maps approved→it and rejected→escalate.'],['Condition','Only <code>simulate_rejection</code>; no browser/database approval check.'],
 ['Next nodes','Normal: it→compliance→finance→assess. Rejection: escalate→END.'],['Database interaction','Each stage delegates to agents; <code>_record</code> appends in-memory log and inserts agent_runs. <code>_activate</code> conditionally updates exit_cases.'],
 ['Return value','The final state returned by <code>supervisor_graph.invoke</code>.'],
])}
<div class="flow">case_id + optional texts + simulate_rejection
  ↓ _hr_stage: activate; checklist; optional KT review; HR routing
  ↓ _manager_gate: manager routing; record approved/rejected
  ↓ _route_after_manager
  ├── "rejected" → _escalate → insert open escalation task → END
  └── "approved" → _it_stage → plan + IT routing
                     ↓ _compliance_stage → compliance + multi-system status
                     ↓ _finance_stage → finance task/status
                     ↓ _assess_stage → optional interview + risk
                     ↓ final SupervisorState</div>
${codeRange('agents/hub/supervisor.py',45,68,'State and durable recording',[
  '<b>Lines 45–50:</b> The shared state contains only routing inputs and an accumulating log; agents reload case data from Supabase.',
  '<b>Lines 53–58:</b> <code>_record</code> mutates <code>state.log</code> and inserts the same event into <code>agent_runs</code>.',
  '<b>Lines 61–68:</b> <code>_activate</code> changes only an <code>open</code> case, preventing a rerun from downgrading later status.',
])}
${codeRange('agents/hub/supervisor.py',87,157,'Nodes and branch behavior',[
  '<b>Lines 87–96:</b> HR activation/checklist are unconditional; KT review is conditional on text; routing is recorded, not assigned to the case row.',
  '<b>Lines 98–112:</b> The manager node records a simulated decision and the routing function converts the boolean into an edge key.',
  '<b>Lines 115–124:</b> Rejection inserts one open escalation task and terminates this graph branch.',
  '<b>Lines 126–157:</b> The approved branch generates IT work, evaluates compliance/system state, evaluates finance, then optionally analyzes the interview and always scores risk.',
])}
${codeRange('agents/hub/supervisor.py',165,197,'Graph construction and invocation',[
  '<b>Lines 165–175:</b> Each Python function becomes a named LangGraph node.',
  '<b>Lines 177–185:</b> Edges define the exact order; only manager_gate is conditional.',
  '<b>Lines 186–197:</b> Compilation creates the runnable graph; <code>run_case</code> supplies the initial state and returns the final state.',
])}
</section>

<section class="section"><span class="eyebrow">SECTION 6</span><h1>Service / API code</h1>
<h2>Supabase Edge Function endpoints</h2>
${table(['HTTP method','Endpoint / handler','Input','Validation','Calls','Database changes','Response'],[
 ['POST','<code>submit-resignation</code><br><code>Deno.serve</code>','last_working_day, optional reason; Authorization JWT','POST only; date string required; JWT user must exist; profile.role must be employee; returns existing case idempotently.','Supabase Auth, profiles lookup.','Inserts exit_cases only when absent.','{ ok:true, case } or structured error.'],
 ['POST','<code>ask</code><br><code>Deno.serve</code>','question string','POST only; nonempty string. Function code does not call getUser; platform JWT enforcement is outside this file.','Embedding endpoint, match_exit_docs RPC, message endpoint.','No database writes.','{ answer, sources, refused, general }.'],
 ['POST','<code>forward-to-hr</code><br><code>Deno.serve</code>','question string; Authorization JWT','POST only; question required; JWT validated with getUser.','profiles, Gmail SMTP; fallback case lookup.','On SMTP failure inserts agent_runs fallback row.','{ ok:true } or { ok:true, delayed:true, message }.'],
])}
<h2>Local Python endpoints</h2>
${table(['Method','Endpoint','Function','Required input','Validation / gate','Agent or work called','Database effect','Response'],[
 ['POST','/activate-exit','activate_case','case_id','Case must exist.','hr_agent.generate_checklist; resignation_notice','tasks; exit_cases.status; email audit','ok, checklist, manager_notice'],
 ['POST','/submit-exit-interview','submit_exit_interview','case_id','Interview row must exist.','exit_intel_agent.run_per_case','updates exit_interviews','ok, analysis'],
 ['POST','/issue-relieving-letter','issue_relieving_letter','case_id','Case must exist; final authorization occurred in prior browser DB update.','relieving_letter_notice','email audit only','ok, notice'],
 ['POST','/validate-document','validate_document','case_id, document_id','document_id required; row matched to case.','doc_collection.validate_one; compliance_agent.run_for_case','case_documents, compliance task/checks, audit','ok, validation, compliance'],
 ['POST','/execute-deprovisioning','execute_deprovisioning','case_id','Only stage=it status=done tasks are selected by agent.','it_deprovisioning_agent.execute_approved_tasks; compliance','agent_runs, compliance rows','ok, executed, compliance'],
 ['POST','/finance-settle-check','finance_settle_check','case_id','Finance RPC already set flag; agents recompute from DB.','finance; compliance; risk','finance/compliance tasks; checks; case risk; audits','ok + three results'],
 ['POST','/manager-approve','manager_approve','case_id','Case exists; no open escalation; KT tasks exist; all are done.','IT plan; compliance','manager/IT audit, IT tasks, compliance rows','advanced true/false + reason/results'],
 ['POST','/reject-manager-task','reject_manager_task','case_id, task_id, reason','Task belongs to case, manager stage, not escalation; reason nonempty.','Direct mirror of escalation write.','exit_tasks escalation; agent_runs','ok or validation error'],
 ['POST','/escalation-audit','log_escalation_transition','case_id, task_id, action, actor_name','action is rerouted/resolved; browser RLS already performed state change.','Audit; closes task only for resolved state.','agent_runs; possibly exit_tasks.status','ok'],
])}
<div class="note warning"><b>Authentication boundary:</b> <code>agents/service.py</code> binds to localhost and performs no JWT authentication. It uses the service-role client. Its checks are workflow/data checks, not caller-identity checks.</div>

<h2>One complete request: manager approval</h2>
<div class="flow">ManagerPages.useApprove.approveTask(task)
  ↓ anon-key UPDATE exit_tasks SET status='done' WHERE id=task.id
  ↓ Postgres RLS 0008 validates manager ownership + forward-only status
  ↓ POST /manager-approve { case_id }
  ↓ Handler.do_POST parses JSON and dispatches manager_approve
  ↓ read manager tasks + exclude Escalated* rows
  ↓ open escalation? stop
  ↓ no KT tasks or any pending? return advanced=false
  ↓ insert manager approved agent_run if latest decision is not approved
  ↓ it_deprovisioning_agent.generate → it_agent.generate_plan
  ↓ compliance_agent.run_for_case
  ↓ return { ok:true, advanced:true, it_plan, compliance }
  ↓ ManagerPages reloads data</div>
${codeRange('agents/service.py',323,397,'HTTP dispatcher',[
  '<b>Lines 323–337:</b> Helper methods add CORS and encode JSON; OPTIONS answers the browser preflight.',
  '<b>Lines 340–355:</b> A literal route table maps all nine paths to Python functions.',
  '<b>Lines 356–373:</b> Unknown paths, invalid JSON, and missing case_id return 4xx responses.',
  '<b>Lines 374–381:</b> Runtime exceptions become JSON 500 responses without stopping the server.',
  '<b>Lines 387–397:</b> <code>ThreadingHTTPServer</code> listens only on localhost:8787 and serves until stopped.',
])}
</section>

<section class="section"><span class="eyebrow">SECTION 7</span><h1>RAG code path</h1>
<div class="flow">scripts/exit_policy.md
  ↓ scripts/ingest_docs.js · chunkText
  ↓ one chunk per §n.n section
  ↓ embed(chunk) → Portkey /v1/embeddings
  ↓ exit_docs(source, section, content, embedding vector(1536))
  ↓ employee question → supabase/functions/ask/index.ts
  ↓ embed(question)
  ↓ db.rpc('match_exit_docs', query_embedding, match_count=4)
  ↓ 0003_rag.sql orders by embedding &lt;=&gt; query_embedding
  ↓ context = [section] + content for each returned chunk
  ↓ askModel(context, question)
  ↓ parseReply → answer + named sections + scope
  ↓ citations matched to retrieved chunks; threshold 0.35
  ↓ { answer, sources, refused, general } → EmployeePages</div>
${table(['Question','Actual answer'],[
 ['Where are documents stored?','The source policy is <code>scripts/exit_policy.md</code>. Each chunk and vector is stored in PostgreSQL table <code>exit_docs</code>. Employee uploads are separate: Storage bucket <code>exit-documents</code> plus metadata in <code>case_documents</code>; those uploads are not RAG sources.'],
 ['Where are embeddings generated?','Both ingestion and query embedding call the configured Portkey <code>/v1/embeddings</code> URL. The model route is <code>PORTKEY_VIRTUAL_KEY</code>.'],
 ['Where are vectors stored?','<code>exit_docs.embedding vector(1536)</code>, indexed with HNSW cosine operators.'],
 ['How does similarity search happen?','<code>match_exit_docs</code> returns <code>1 - (embedding &lt;=&gt; query_embedding)</code>, ordered by distance, limited to four rows.'],
 ['How is context passed?','The Edge Function joins retrieved rows as <code>[section]\ncontent</code> and sends that plus the question in one user message.'],
 ['How are citations produced?','The model returns a <code>sections</code> array. Code matches those names case-insensitively to retrieved rows, deduplicates them, and falls back to only the best chunk. No citation is returned for general/refused output or when best similarity is below 0.35.'],
 ['How does access/privacy filtering work?','RLS is enabled on <code>exit_docs</code> with no browser policies. The Edge Function uses the service-role key to retrieve. The retrieval query has no employee, department, document, or ACL filter: every row in <code>exit_docs</code> is in the same policy corpus.'],
])}
<div class="note truth"><b>No RAG over uploaded case documents.</b> <code>case_documents</code> files are OCR-validated for compliance. They are never chunked into <code>exit_docs</code> and never supplied to <code>askModel</code>.</div>
${codeRange('scripts/ingest_docs.js',22,47,'Chunk and label policy sections',[
  '<b>Lines 22–29:</b> The fixed source name and comment establish one row group per local markdown file.',
  '<b>Lines 29–40:</b> Blank lines form paragraphs; a paragraph beginning with the section marker starts a new chunk; continuations append.',
  '<b>Lines 42–47:</b> <code>sectionOf</code> extracts the citation label stored beside the text.',
])}
${codeRange('scripts/ingest_docs.js',49,94,'Embed and replace stored vectors',[
  '<b>Lines 49–64:</b> <code>embed</code> posts the raw chunk and returns the first embedding vector.',
  '<b>Lines 66–74:</b> <code>main</code> reads the local policy and deletes prior rows for the same source.',
  '<b>Lines 76–90:</b> Every chunk is embedded, dimension-checked, and inserted with source/section/content.',
  '<b>Lines 94 onward:</b> Process exit status represents success or failure for this manual script.',
])}
${codeRange('supabase/migrations/0003_rag.sql',22,44,'Similarity RPC',[
  '<b>Lines 22–28:</b> Input is a 1536-value vector and optional top-k count; output columns include similarity.',
  '<b>Lines 32–43:</b> The SELECT converts cosine distance to similarity, sorts nearest first, and limits the result.',
  '<b>Security detail:</b> The function is intentionally not SECURITY DEFINER. The ask function can call it because its service-role client bypasses RLS.',
])}
${codeRange('supabase/functions/ask/index.ts',180,255,'Retrieve, ground, classify, and cite',[
  '<b>Lines 180–195:</b> The handler accepts OPTIONS/POST and validates question text.',
  '<b>Lines 197–215:</b> It embeds once, retrieves four chunks, and refuses immediately if retrieval is empty.',
  '<b>Lines 217–227:</b> Chunks become labelled context; the LLM reply is parsed into answer/sections/scope.',
  '<b>Lines 228–251:</b> Scope and similarity decide whether citations are allowed; section names select only actually used chunks.',
  '<b>Lines 253–255:</b> The structured result is returned to React.',
])}
</section>

<section class="section"><span class="eyebrow">SECTION 8</span><h1>Database flow</h1>
${table(['Table / storage','Purpose','Read by','Written by','Important fields','Relationships'],[
 ['profiles','Auth-user role and identity.','App/layouts, submit/forward Edge Functions, routing, risk, notifications.','Seeds/admin; OOO setting.','id, role, employee_id, department, out_of_office','id→auth.users; employee_id→exit_cases.employee_id.'],
 ['exit_cases','One offboarding case and final HR-only assessment.','Service, all operational agents, role views, HR.','submit-resignation; service activation; risk; finance RPC; HR relieving update.','employee_id, manager_id, hr_id, last_working_day, status, finance_cleared, risk_*, relieving_*','Parent of tasks/interviews/docs/runs/checks.'],
 ['exit_tasks','All workflow items and gates.','Every role layout; service; finance/compliance/IT agents.','HR/IT/finance/compliance agents; employee/manager/IT RLS updates; escalation code.','Base migration: case_id, stage, title, status, due_date, kt_event_id. Code also expects reason and escalation_state.','Many tasks belong to one exit_case.'],
 ['exit_interviews','Raw employee answers plus LLM analysis.','Exit intelligence, risk, HR.','Employee submit; exit_intel update/insert.','case_id, raw answers, summary, sentiment, themes, rehire_*','One logical interview per case.'],
 ['case_documents','Metadata and OCR validation for uploads.','Employee/HR UI, doc collection, compliance, multi-system clearance.','Employee insert; doc collection update.','case_id, doc_type, file_path, status, validation_detail','File bytes live in exit-documents Storage.'],
 ['kt_reviews','KT summary/gaps, restricted to HR/manager.','HR/manager if queried.','hr_agent KT persist.','case_id, summary, gaps, complete','Belongs to exit_case.'],
 ['compliance_checks','One row per explicit compliance item expected by Python and verification code.','Regression verification script; no current React query reads it.','compliance_agent upsert.','Code expects case_id, item, status, source, evidence, failure_reason, checked_at.','Code assumes a unique case_id,item key, but no CREATE TABLE appears in migrations 0001–0030.'],
 ['agent_runs','Durable activity/audit events.','HR layout; compliance manager signal; IT view verification subquery.','Supervisor, service, risk, email, routing, document, IT, analytics.','0009 defines case_id, stage, detail. Code also writes/reads agent, status, metadata.','Belongs to exit_case; the extra audit columns are not added by migrations 0001–0030.'],
 ['trend_alerts','Repeated exit-interview themes.','HR, attrition agent.','exit_intel longitudinal.','theme, department, severity, detail','Derived across cases.'],
 ['analytics_insights','Stored narratives and structured stats.','HR layout.','Four analytics agents.','narrative, stats, agent_type, created_at','Rows distinguished by agent_type.'],
 ['exit_docs','RAG chunk store.','match_exit_docs via ask service-role client.','ingest_docs.js.','source, section, content, embedding','Independent policy corpus; no case_id.'],
 ['Storage: exit-documents','Employee-uploaded file bytes.','doc_collection download.','Employee Documents upload.','path = case_id/docType-timestamp.ext','case_documents.file_path points here.'],
])}
<div class="note truth"><b>Migration drift visible in this repository:</b> Python/React code uses <code>compliance_checks</code>; <code>exit_tasks.reason</code>/<code>escalation_state</code>; and <code>agent_runs.agent</code>/<code>status</code>/<code>metadata</code>. No migration in <code>supabase/migrations/0001–0030</code> creates those objects/columns. Migration 0026 even updates <code>escalation_state</code> and 0025 reads <code>agent_runs.status/metadata</code>, so a fresh database built only from these files is not self-contained at those points.</div>
<h2>Operational write chain</h2>
<div class="flow">submit-resignation → exit_cases
service.activate_case → exit_cases.status + exit_tasks(hr/manager) + agent_runs(email)
manager approval → exit_tasks(manager done) → agent_runs(manager) → exit_tasks(it)
IT approval → exit_tasks(it done) → agent_runs(it_deprovisioning_execution)
compliance_agent → exit_tasks(compliance) + compliance_checks
finance RPC → exit_cases.finance_cleared/dues_note
finance_agent → exit_tasks(finance)
risk_agent → exit_cases.risk_score/risk_level/rehire_eligible + agent_runs
HR issue → exit_cases.relieving_* + status=completed → agent_runs(email)</div>
<h2>Views and RPCs used by browser roles</h2>
${table(['Object','Consumer','What it exposes/changes'],[
 ['employee_exit_view','EmployeeLayout','Own safe case fields, including relieving state; excludes risk fields.'],
 ['manager_case_view','ManagerLayout','Cases assigned to auth.uid() with no HR-only assessment fields.'],
 ['it_task_view','ItLayout','IT tasks plus case display fields and latest execution verification status.'],
 ['finance_case_view','FinanceLayout','Safe case/finance fields; excludes risk and interview fields.'],
 ['employee_interview_status_view','EmployeePages.ExitInterview','Only whether the current employee has submitted.'],
 ['finance_mark_dues_settled','FinancePages.useSettle','Security-definer role check; sets finance_cleared=true and dues note.'],
 ['finance_reject_dues','FinancePages.useReject','Security-definer role check; clears finance flag and records rejection reason.'],
 ['exit_case_cleared_for_relieving','RLS WITH CHECK for HR update','Requires finance_cleared, all four visible stages done, and all four stages present.'],
 ['match_exit_docs','ask Edge Function','Returns nearest policy chunks to a query vector.'],
])}
</section>

<section class="section"><span class="eyebrow">SECTION 9</span><h1>Line-by-line source walkthrough</h1>
<p>Each excerpt below is copied directly from the current source file. The line notes explain the control flow and data effects of that exact block.</p>

<h2>9.1 React startup and routing</h2>
${codeRange('src/main.jsx',1,14,'Mount the application',[
  '<b>Lines 1–7:</b> Import React root APIs, <code>App</code>, icon CSS, and the two global stylesheets.',
  '<b>Lines 9–14:</b> Find <code>#root</code> in <code>index.html</code> and render <code>App</code> inside StrictMode.',
])}
${codeRange('src/App.jsx',19,64,'Resolve session and role',[
  '<b>Lines 19–23:</b> Three states distinguish authentication loading, resolved role, and optional dev override.',
  '<b>Lines 27–34:</b> Initial session lookup and auth-change subscription keep session state current; cleanup unsubscribes.',
  '<b>Lines 38–50:</b> When logged in, read only <code>profiles.role</code> for the authenticated user.',
  '<b>Lines 53–64:</b> Render nothing while resolving, LoginPage without a session, otherwise role-aware routes.',
])}
${codeRange('src/routes/AppRoutes.jsx',20,109,'Role-guarded routes',[
  '<b>Lines 20–28:</b> The component receives the database-derived role and the Auth session.',
  '<b>Lines 31–50:</b> Employee resignation is a separate route; employee child paths render inside EmployeeLayout.',
  '<b>Lines 52–103:</b> Manager, IT, HR, and Finance each get their own guarded nested route tree.',
  '<b>Lines 105–109:</b> Unknown paths redirect to the current role root.',
])}
${codeRange('src/lib/supabase.js',1,9,'Shared browser client',[
  '<b>Lines 1–4:</b> Import the SDK and create one exported client from Vite environment variables.',
  '<b>Lines 5–9:</b> The comments state the trust model: the anon key is public; RLS controls data access; the service key must not be used here.',
])}

<h2>9.2 Employee actions</h2>
${codeRange('src/routes/employee/EmployeePages.jsx',166,182,'Policy question and forward action',[
  '<b>Lines 166–174:</b> Empty or duplicate submissions are ignored; <code>ask</code> receives only the question and its result/error becomes component state.',
  '<b>Lines 176–182:</b> Forwarding is a second explicit Edge Function call; it does not happen automatically on refusal.',
])}
${codeRange('src/routes/employee/EmployeePages.jsx',595,630,'Upload and OCR trigger',[
  '<b>Lines 595–605:</b> Build a case-scoped Storage path and upload the bytes; abort on upload failure.',
  '<b>Lines 606–615:</b> Insert metadata and capture the new document id.',
  '<b>Lines 616–629:</b> Best-effort POST triggers Python OCR/compliance; failure leaves the row submitted and the UI reloads.',
])}
${codeRange('src/routes/employee/EmployeePages.jsx',719,751,'Submit exit interview',[
  '<b>Lines 719–730:</b> Validate required fields and insert the employee-authored answers under RLS.',
  '<b>Lines 731–735:</b> A database error remains visible in the form.',
  '<b>Lines 736–751:</b> Best-effort service call asks the Python agent to enrich the same row; raw submission remains even if service is unavailable.',
])}
${codeRange('src/routes/employee/EmployeePages.jsx',832,860,'Submit resignation and activate',[
  '<b>Lines 832–844:</b> Invoke the authenticated Edge Function; stop on either transport or returned application error.',
  '<b>Lines 845–857:</b> The returned case id is sent to the local activation service. This follow-up is intentionally non-fatal.',
  '<b>Lines 858–860:</b> Clear busy state and navigate to the dashboard.',
])}

<h2>9.3 Human gates</h2>
${codeRange('src/routes/manager/ManagerPages.jsx',66,105,'Approve KT and trigger advancement',[
  '<b>Lines 66–75:</b> Directly update the selected task to done; RLS decides whether that update is allowed.',
  '<b>Lines 76–96:</b> For manager-stage tasks, call <code>/manager-approve</code>; the service rechecks the complete task set.',
  '<b>Lines 97–105:</b> Reload and remove the action state after the write.',
])}
${codeRange('src/routes/manager/ManagerPages.jsx',112,140,'Reject KT',[
  '<b>Lines 112–117:</b> Require a human-entered reason before calling the service.',
  '<b>Lines 118–132:</b> Unlike best-effort follow-ups, rejection has no prior database write, so HTTP/service failures are shown.',
  '<b>Lines 133–140:</b> Reload only after confirmed success.',
])}
${codeRange('src/routes/it/ItPages.jsx',49,78,'Approve and execute IT task',[
  '<b>Lines 49–57:</b> The human approval is the direct RLS-protected status update.',
  '<b>Lines 58–69:</b> The service then executes/verifies every approved unaudited IT task for the case.',
  '<b>Lines 70–78:</b> Reload shows task and verification state.',
])}
${codeRange('src/routes/finance/FinancePages.jsx',20,51,'Settle dues and recompute agents',[
  '<b>Lines 20–31:</b> Call the security-definer finance RPC instead of directly updating the hidden base case row.',
  '<b>Lines 32–43:</b> Best-effort Python follow-up recalculates finance/compliance/risk.',
  '<b>Lines 44–51:</b> Reload and clear action state.',
])}
${codeRange('src/routes/hr/HrPages.jsx',312,343,'Resolve or reroute escalation',[
  '<b>Lines 312–325:</b> Update only an open escalation and request the returned row; no row means the transition lost its race or RLS rejected it.',
  '<b>Lines 326–334:</b> Send a non-fatal audit event after the authoritative database transition.',
  '<b>Lines 335–343:</b> Reload and clear UI state.',
])}
${codeRange('src/routes/hr/HrPages.jsx',510,544,'Issue relieving letter',[
  '<b>Lines 510–516:</b> The UI preview requires finance clearance, no prior issue, all four stages present, and every relevant task done.',
  '<b>Lines 518–534:</b> HR writes issued metadata and completed status; PostgreSQL repeats/enforces the gate.',
  '<b>Lines 535–544:</b> Sending the notice is a non-fatal service follow-up.',
])}

<h2>9.4 Edge Functions</h2>
${codeRange('supabase/functions/submit-resignation/index.ts',49,82,'Authenticate and load employee profile',[
  '<b>Lines 49–57:</b> Accept OPTIONS/POST, parse the form, validate last_working_day.',
  '<b>Lines 59–72:</b> Require the Authorization header and validate the JWT through <code>getUser</code>.',
  '<b>Lines 74–82:</b> Load identity with the admin client, but reject non-employee callers.',
])}
${codeRange('supabase/functions/submit-resignation/index.ts',84,114,'Idempotent case creation',[
  '<b>Lines 84–92:</b> Return an existing case for the employee, preventing duplicate resignations.',
  '<b>Lines 94–95:</b> Select the first seeded manager and HR profile.',
  '<b>Lines 97–111:</b> Insert server-derived identity plus client-provided date/reason and return the row.',
])}
${codeRange('supabase/functions/ask/index.ts',82,98,'Question embedding',[
  '<b>Lines 82–94:</b> POST the input to the configured embeddings route with bearer authentication.',
  '<b>Lines 95–98:</b> Fail on non-2xx response and return the first vector.',
])}
${codeRange('supabase/functions/ask/index.ts',122,178,'Parse LLM output and call model',[
  '<b>Lines 122–151:</b> Parse the requested JSON, tolerate fenced or almost-JSON output, and fall back to raw answer text.',
  '<b>Lines 154–177:</b> Send system prompt plus labelled context/question to the configured message endpoint and extract the text block.',
])}
${codeRange('supabase/functions/forward-to-hr/index.ts',43,71,'Authenticate explicit forwarding',[
  '<b>Lines 43–51:</b> Accept only POST and validate a string question.',
  '<b>Lines 53–65:</b> Read and validate caller identity from the JWT, not the request body.',
  '<b>Lines 67–71:</b> Read the caller’s own safe profile through the authenticated client.',
])}
${codeRange('supabase/functions/forward-to-hr/index.ts',73,130,'Send or durably log',[
  '<b>Lines 73–99:</b> Open Gmail SMTP, send within an eight-second timeout, close, and return success.',
  '<b>Lines 100–124:</b> On SMTP failure, find the employee’s recent case and store the question/error in agent_runs.',
  '<b>Lines 126–130:</b> Return a delayed-success message because HR can still see the logged item.',
])}

<h2>9.5 Python service</h2>
${codeRange('agents/service.py',67,105,'Activation and interview entry points',[
  '<b>Lines 67–80:</b> Activation loads the case, generates an idempotent checklist, marks it in progress, and sends a notice.',
  '<b>Lines 83–92:</b> Relieving endpoint only sends; the HR browser update already changed the case.',
  '<b>Lines 95–105:</b> Interview endpoint reads raw fields and formats a transcript for exit intelligence.',
])}
${codeRange('agents/service.py',113,155,'Document, IT, and finance events',[
  '<b>Lines 113–126:</b> Validate one uploaded document, then immediately recompute compliance.',
  '<b>Lines 129–138:</b> Execute approved IT tasks and recompute compliance.',
  '<b>Lines 141–155:</b> Recompute finance, compliance, and risk after the finance RPC.',
])}
${codeRange('agents/service.py',158,230,'Manager approval gate',[
  '<b>Lines 158–189:</b> The comments define this as the browser equivalent of the approved supervisor branch; first verify case existence.',
  '<b>Lines 191–211:</b> Separate escalation rows from KT rows, block on open escalation, missing KT, or pending KT.',
  '<b>Lines 213–223:</b> Persist one latest approved decision when necessary.',
  '<b>Lines 225–230:</b> Generate the idempotent IT plan; the following lines record IT and run compliance.',
])}
${codeRange('agents/service.py',233,296,'Manager rejection and escalation audit',[
  '<b>Lines 233–255:</b> Validate required fields and ensure the target is a manager KT task for the case.',
  '<b>Lines 257–280:</b> Prevent duplicate/open/resolved transitions; reopen an eligible row or insert the first escalation.',
  '<b>Lines 282–289:</b> Persist an escalation activity row.',
  '<b>Lines 293–296:</b> The audit endpoint begins by allowing only rerouted/resolved actions.',
])}

<h2>9.6 Shared Python infrastructure</h2>
${codeRange('agents/core/config.py',26,73,'Load runtime configuration',[
  '<b>Lines 26–29:</b> Load the repository root .env with override enabled.',
  '<b>Lines 35–39:</b> Required database and LLM values fail immediately when missing.',
  '<b>Lines 45–66:</b> Email/calendar values include optional safety gates and defaults.',
  '<b>Line 73:</b> Construct one service-role Supabase client shared by Python agents.',
])}
${codeRange('agents/core/llm.py',37,82,'Low-level LLM request',[
  '<b>Lines 37–58:</b> Build and send an Anthropic-compatible message request using configured gateway/model.',
  '<b>Lines 59–71:</b> Raise on HTTP failure, find the text block, and report missing output explicitly.',
  '<b>Lines 73–82:</b> Wrap text and usage in an attribute-style object used by tracing.',
])}
${codeRange('agents/core/llm.py',87,102,'Text and JSON public helpers',[
  '<b>Lines 87–89:</b> <code>ask_claude</code> times the request and returns text.',
  '<b>Lines 95–102:</b> <code>ask_claude_json</code> extracts the first brace-delimited object and parses it.',
])}
${codeRange('agents/core/prompts.py',8,14,'Prompt loader',[
  '<b>Line 10:</b> Resolve the repository prompts directory from this file location.',
  '<b>Lines 13–14:</b> Read the requested UTF-8 markdown and remove only trailing newlines.',
])}
${codeRange('agents/core/trace.py',90,149,'Node, LLM, and database tracing',[
  '<b>Lines 90–121:</b> The decorator logs start/result/failure/timing and restores ContextVar depth on both paths.',
  '<b>Lines 126–138:</b> <code>log_llm</code> times the supplied zero-argument call and logs tokens/preview.',
  '<b>Lines 141–149:</b> <code>log_db</code> formats an audit line only; it never performs a DB operation.',
])}
${codeRange('agents/core/notifications.py',49,80,'Compose and send safely',[
  '<b>Lines 49–59:</b> Build one plain-text message shape used by all templates.',
  '<b>Lines 62–68:</b> Without EMAIL_TEST_RECIPIENT, print and return without SMTP.',
  '<b>Lines 70–80:</b> Otherwise force the configured test recipient, create MIME headers, and send through Gmail SSL.',
])}
${codeRange('agents/core/calendar_booking.py',69,106,'Create and persist KT event',[
  '<b>Lines 69–90:</b> Build an all-day event from the case/task; return a logged-only result when OAuth is absent.',
  '<b>Lines 92–97:</b> Insert through Calendar API and return the event id/link.',
  '<b>Lines 100–106:</b> Public wrapper writes the returned event id back to the task.',
])}

<h2>9.7 Operational agents</h2>
${codeRange('agents/spokes/checklist_generator_agent.py',14,21,'Checklist compatibility wrapper',[
  '<b>Lines 14–21:</b> One traced function delegates directly to <code>hr_agent.generate_checklist</code>; there is no second checklist implementation.',
])}
${codeRange('agents/spokes/kt_document_reviewer_agent.py',12,22,'KT reviewer compatibility wrapper',[
  '<b>Lines 12–15:</b> Import the existing HR review implementation and the trace decorator.',
  '<b>Lines 18–22:</b> The named agent adds trace identity, then delegates all behavior to <code>hr_agent.review_kt_document</code>.',
])}
${codeRange('agents/spokes/hr_agent.py',92,139,'Generate and persist checklist',[
  '<b>Lines 92–103:</b> State carries case data and LLM result; generation sends role and department.',
  '<b>Lines 107–128:</b> Persistence splits manager titles into IT-owned versus KT, creates HR/manager rows with stage-specific due dates.',
  '<b>Lines 129–139:</b> Batch insert, trace the write, and book calendar events only for inserted manager rows.',
])}
${codeRange('agents/spokes/hr_agent.py',158,168,'Checklist idempotency and invocation',[
  '<b>Lines 158–165:</b> Unless forced, any existing HR/manager task makes generation return <code>skipped</code>.',
  '<b>Lines 167–168:</b> Load the full case and invoke the compiled checklist graph.',
])}
${codeRange('agents/spokes/hr_agent.py',182,232,'Review KT document and persist gaps',[
  '<b>Lines 182–193:</b> Ask the model to return a structured review for raw KT text.',
  '<b>Lines 197–223:</b> Read existing manager titles, deduplicate gap tasks, and insert neutral follow-ups.',
  '<b>Lines 226–232:</b> Store the evaluative summary/gaps separately in kt_reviews.',
])}
${codeRange('agents/spokes/it_agent.py',44,78,'Generate and persist IT plan',[
  '<b>Lines 44–57:</b> State includes case/result; generation sends role and department to the IT prompt.',
  '<b>Lines 60–72:</b> Convert returned titles into stage=it pending tasks due on the last working day and insert them.',
  '<b>Lines 75–78:</b> The two nodes form a generate→persist graph.',
])}
${codeRange('agents/spokes/it_deprovisioning_agent.py',59,84,'Classify and verify IT actions',[
  '<b>Lines 59–69:</b> Title keywords map to asset, identity, repository, or generic access actions.',
  '<b>Lines 72–84:</b> Verification independently recalculates the expected type and requires both adapter success and a type match.',
])}
${codeRange('agents/spokes/it_deprovisioning_agent.py',123,167,'Execute approved tasks once',[
  '<b>Lines 123–126:</b> Planning wrapper delegates to the ordinary IT plan agent.',
  '<b>Lines 129–146:</b> Select only done IT tasks, load prior audits, and build the set of already verified task ids.',
  '<b>Lines 148–167:</b> Skip verified tasks, execute and verify remaining tasks, then insert one audit row per attempt.',
])}
${codeRange('agents/spokes/finance_agent.py',46,91,'Calculate finance clearance',[
  '<b>Lines 46–60:</b> Read HR/manager/IT task statuses and the case finance flag; clearance requires both.',
  '<b>Lines 61–77:</b> Build a done/pending finance row and insert it when absent.',
  '<b>Lines 78–86:</b> Update existing rows and detect only a new transition to done.',
  '<b>Lines 88–91:</b> Send completion notice once and store result in graph state.',
])}
${codeRange('agents/spokes/compliance_agent.py',44,118,'Evaluate compliance signals',[
  '<b>Lines 44–67:</b> Legacy three-item evaluation uses matching done tasks or validated matching documents.',
  '<b>Lines 70–84:</b> Item-level helper distinguishes missing evidence from incomplete evidence.',
  '<b>Lines 87–118:</b> Manager approval, IT completion, and finance clearance each use explicit signals rather than keyword matching.',
])}
${codeRange('agents/spokes/compliance_agent.py',151,215,'Persist summary and item checks',[
  '<b>Lines 151–161:</b> Read non-compliance tasks and validated document types, then compute the summary result.',
  '<b>Lines 164–181:</b> Update or insert exactly one stage=compliance summary task.',
  '<b>Lines 185–215:</b> Read latest manager decision and finance flag, evaluate five explicit items, and upsert each compliance_checks row.',
])}
${codeRange('agents/spokes/risk_agent.py',56,100,'Compute risk deterministically',[
  '<b>Lines 56–68:</b> Parse profile creation time as a tenure proxy and return a banded factor.',
  '<b>Lines 70–73:</b> Incomplete-task ratio supplies the task factor.',
  '<b>Lines 76–96:</b> Look up the other factors, apply fixed weights, assign risk band, and choose rehire eligibility.',
  '<b>Lines 97–100:</b> Return only the three values persisted on exit_cases.',
])}
${codeRange('agents/spokes/risk_agent.py',108,147,'Load, score, and persist risk',[
  '<b>Lines 108–121:</b> Load case, employee profile creation time, interview signal, and all task statuses; call pure <code>score</code>.',
  '<b>Lines 124–133:</b> Update the case and insert a risk audit row.',
  '<b>Lines 146–147:</b> Public entry invokes the two-node graph.',
])}
${codeRange('agents/spokes/exit_intel_agent.py',38,86,'Analyze and persist one interview',[
  '<b>Lines 38–49:</b> Graph state holds transcript/result; the analyze node sends the transcript to the structured prompt.',
  '<b>Lines 52–72:</b> Map model output to database fields and update an existing interview or insert one.',
  '<b>Lines 77–86:</b> Compile analyze→persist and expose <code>run_per_case</code>.',
])}
${codeRange('agents/spokes/doc_collection.py',83,115,'Document requirements and content rules',[
  '<b>Lines 83–86:</b> Required document types are base plus department-specific extras.',
  '<b>Lines 88–98:</b> Classification computes submitted and missing sets without storing missing rows.',
  '<b>Lines 101–115:</b> Validation requires at least one keyword in every rule group, then optional employee-name and date checks.',
])}
${codeRange('agents/spokes/doc_collection.py',156,214,'OCR one stored document',[
  '<b>Lines 156–163:</b> Company Asset Declaration uses department-aware asset/identity/date checks; other types use shared rules.',
  '<b>Lines 166–185:</b> Download bytes, OCR through Pillow/Tesseract, evaluate, update status/detail, and audit.',
  '<b>Lines 199–214:</b> <code>validate_one</code> binds the document to the case before running the same row validator.',
])}
${codeRange('agents/spokes/smart_routing.py',42,67,'Choose an approver',[
  '<b>Lines 42–49:</b> Empty candidates produce a non-crashing “no approver” decision.',
  '<b>Lines 51–57:</b> Prefer department matches, then the first available person; delegate means the first choice was skipped.',
  '<b>Lines 59–67:</b> If everyone is out, choose the primary but explicitly flag all_ooo.',
])}
${codeRange('agents/spokes/multi_system_clearance.py',166,201,'Fetch and consolidate system statuses',[
  '<b>Lines 166–175:</b> Call each stand-in adapter and separately load all case document rows.',
  '<b>Lines 178–187:</b> Consolidate, build a detailed audit line, and insert agent_runs.',
  '<b>Lines 198–201:</b> Public function invokes the graph and returns only its status object.',
])}
${codeRange('agents/spokes/email_drafting_agent.py',42,83,'Audit every email outcome',[
  '<b>Lines 42–64:</b> Normalize recipients/outcomes into agent_runs metadata and insert one email-drafting audit.',
  '<b>Lines 67–80:</b> Call the notification function, catch any exception, audit failure, and return without raising.',
  '<b>Lines 82–83:</b> The following exported template functions all use this wrapper.',
])}
${codeRange('agents/spokes/rehire_agent.py',30,61,'Standalone rehire recommendation',[
  '<b>Lines 30–43:</b> Eligibility false wins; otherwise high risk triggers review, and remaining cases are recommended.',
  '<b>Lines 46–61:</b> Read existing computed fields/reason, build assessment, insert audit, return it. This does not update exit_cases.',
])}

<h2>9.8 Analytics and capstone runners</h2>
${codeRange('agents/analytics/analytics_agent.py',34,84,'Aggregate, narrate, persist',[
  '<b>Lines 34–59:</b> Load cases/tasks and calculate counts in Python.',
  '<b>Lines 63–68:</b> The model receives already-computed stats and writes only narrative.',
  '<b>Lines 71–84:</b> Persist narrative, raw stats, and agent_type.',
])}
${codeRange('agents/analytics/sla_escalation.py',39,72,'Find real SLA breaches',[
  '<b>Lines 39–50:</b> Ignore done/missing/not-old-enough tasks and normalize due dates.',
  '<b>Lines 52–72:</b> Resolve case/owner names and emit structured breach objects containing downstream impact.',
])}
${codeRange('agents/analytics/workflow_optimizer.py',64,91,'Reuse breaches for optimization report',[
  '<b>Lines 64–72:</b> Load pending tasks/cases/profiles, reuse <code>find_breaches</code>, and compute bottleneck stats.',
  '<b>Lines 75–79:</b> Ask the model to narrate those stats.',
  '<b>Lines 82–91:</b> Store the report under workflow_optimizer agent_type.',
])}
${codeRange('agents/analytics/policy_auditor.py',168,220,'Gather, audit, report',[
  '<b>Lines 168–192:</b> Load active cases, relevant tasks, and manager decision logs into per-case structures.',
  '<b>Lines 195–200:</b> Run the deterministic audit function.',
  '<b>Lines 204–220:</b> Narrate only when breaches exist and persist both report and counts.',
])}
${codeRange('agents/analytics/attrition_agent.py',79,116,'Department-level attrition signals',[
  '<b>Lines 79–88:</b> Load case risks, trend alerts, and current employee profiles.',
  '<b>Lines 91–95:</b> Run deterministic department signal selection.',
  '<b>Lines 98–116:</b> Narrate only nonempty risk signals and persist with predictive_attrition type.',
])}
${codeRange('agents/hub/e2e_automation.py',73,122,'Initiate, coordinate, and scan SLA',[
  '<b>Lines 73–77:</b> Reuse the same activation function as the browser service.',
  '<b>Lines 80–91:</b> Skip missing cases or call the supervisor with supplied state.',
  '<b>Lines 94–122:</b> Scope the SLA scan to this case, resolve owner names, reuse finder/escalator, and store counts.',
])}
${codeRange('agents/hub/e2e_automation.py',125,177,'Finalize from persisted gates',[
  '<b>Lines 125–135:</b> Missing and simulated-rejection cases return blocked outcomes immediately.',
  '<b>Lines 137–154:</b> Read the actual compliance/finance task rows; only two done rows allow completion.',
  '<b>Lines 156–170:</b> Otherwise report precise blockers, audit the final outcome, and return state.',
  '<b>Lines 173–177:</b> Begin wiring the four-node capstone graph.',
])}

<h2>9.9 Database definitions and gates</h2>
${codeRange('supabase/migrations/0001_schema.sql',49,89,'Case and task tables',[
  '<b>Lines 49–69:</b> exit_cases stores identity/workflow fields and HR-only risk fields, with foreign keys to profiles.',
  '<b>Lines 76–86:</b> exit_tasks stores stage, title, forward-only status values, due date, and optional calendar id.',
  '<b>Lines 88–89:</b> Indexes support the dominant case/stage filters.',
])}
${codeRange('supabase/migrations/0001_schema.sql',125,138,'RAG table and vector index',[
  '<b>Lines 125–131:</b> Each exit_docs row is one source-labelled text chunk and one 1536-dimensional vector.',
  '<b>Lines 136–138:</b> HNSW with cosine operators accelerates nearest-neighbour ordering.',
])}
${codeRange('supabase/migrations/0002_rls.sql',31,49,'Current-role helper and RLS enablement',[
  '<b>Lines 31–42:</b> A stable security-definer helper maps auth.uid() to profiles.role with a fixed search path.',
  '<b>Lines 46–49:</b> RLS is enabled on the main tables before policies grant narrow access.',
])}
${codeRange('supabase/migrations/0013_finance_role.sql',15,26,'Finance schema extension',[
  '<b>Lines 15–17:</b> Replace the original role constraint so finance becomes valid.',
  '<b>Lines 19–21:</b> Add the clearance flag and dues note to exit_cases.',
  '<b>Lines 25–26:</b> Begin finance task visibility policy.',
])}
${codeRange('supabase/migrations/0017_relieving_letter.sql',29,74,'Database-enforced final gate',[
  '<b>Lines 29–49:</b> The helper requires finance clearance, no unfinished hr/manager/it/finance task, and all four stages present.',
  '<b>Lines 51–54:</b> Only authenticated callers may execute the helper.',
  '<b>Lines 56–74:</b> HR update policy permits a one-way issue only when caller/issued_by/status/gate all match.',
])}
${codeRange('supabase/migrations/0030_finance_rpc_null_safe_authz.sql',34,69,'Finance authorization in RPCs',[
  '<b>Lines 34–50:</b> Settlement is security-definer but explicitly checks <code>app_current_role() IS DISTINCT FROM finance</code> before updating.',
  '<b>Lines 54–69:</b> Rejection repeats the same role check and requires a nonblank reason before clearing the flag.',
])}

<h2>9.10 CLI wrapper</h2>
${codeRange('agents/run_case.py',35,63,'Parse files/flags and run supervisor',[
  '<b>Lines 35–37:</b> <code>_read</code> loads optional text files as UTF-8.',
  '<b>Lines 40–48:</b> Require case_id and split remaining CLI flags.',
  '<b>Lines 49–56:</b> Use provided files or built-in demo texts.',
  '<b>Lines 59–63:</b> Time the supervisor call, pass rejection flag, and print the returned log.',
])}

<div class="note"><b>End state:</b> The live browser completes a case only through the HR relieving-letter update and its PostgreSQL gate. The CLI supervisor stops after risk assessment; the separate e2e_automation runner can set completed after persisted compliance and finance rows are both done.</div>
</section>
</body></html>`

fs.writeFileSync(htmlPath, h)

;(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const page = await browser.newPage()
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
  await page.pdf({
    path: pdfPath,
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font:7px Arial;color:#728096;width:100%;padding:0 14mm">ExitAI — Code Line by Line (Rewritten)</div>',
    footerTemplate: '<div style="font:7px Arial;color:#728096;width:100%;padding:0 14mm;display:flex;justify-content:space-between"><span>Verified against repository · 22 Sep 2026</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  })
  await browser.close()
  console.log(`HTML written: ${htmlPath}`)
  console.log(`PDF written: ${pdfPath}`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
