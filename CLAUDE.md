# CLAUDE.md — Exit AI

Project memory for Claude Code. Read this fully before doing anything.

## What Exit AI is
AI-assisted employee offboarding platform: four role-based dashboards (Employee, HR, Manager, IT) plus a Finance dashboard, a RAG assistant, and a multi-agent system that assesses and drives each exit case through the full lifecycle.

---

## Stack (authoritative — do not drift)

| Layer | Tool | Why |
|---|---|---|
| Agent framework | **LangGraph** | Hub-and-spoke graph; each agent is a compiled subgraph the supervisor invokes as one node |
| Architecture pattern | **Hub-and-spoke** | Supervisor hub routes to agent spokes; spokes coordinate only through the hub, never each other |
| LLM (generation) | **Azure OpenAI `@azure-openai-eus2/gpt-5.6-sol`** via Portkey gateway | Migrated FROM Anthropic Claude/Sonnet — same Anthropic Messages API wire format, now routes to Azure. `ANTHROPIC_*` env var names describe the wire protocol, not the vendor |
| Embeddings (RAG) | **OpenAI `text-embedding-3-small`** (1536-dim) via Portkey `PORTKEY_VIRTUAL_KEY` | Used by `scripts/ingest_docs.js` to embed exit_policy.md chunks; dimension must match the pgvector column |
| Database / Auth | **Supabase** (Postgres + Auth + RLS + pgvector + Storage) | Managed DB, row-level security, file storage, Edge Functions all in one service |
| Frontend | **React + Vite** | Component-based; `src/styles/tokens.css` for design tokens; Tabler icons |
| Edge Functions | **Supabase Edge Functions** (Deno/TypeScript) | Serverless; `submit-resignation/`, `ask/`, `forward-to-hr/` |
| Agent HTTP bridge | **Python stdlib `http.server`** — `agents/service.py` on `localhost:8787` | Not Flask/FastAPI (neither in requirements.txt); single dev-machine bridge between the React frontend and the Python pipeline |
| OCR | **Tesseract** via `pytesseract` | Real OCR on uploaded documents (`doc_collection.py`); fallback to `TESSERACT_PATH` env var when `tesseract` is not on PATH |
| Email | **Gmail SMTP** via `smtplib` | Same account as `forward-to-hr` Edge Function; dev-safe: real sends only when `EMAIL_TEST_RECIPIENT` is set |
| Calendar | **Google Calendar API** (OAuth, shared demo account) | KT event booking; auth set up once via `agents/oauth_setup.py` |

---

## File structure (real current paths)

```
agents/
  hub/
    supervisor.py          # Agent #20 — orchestrator; the main hub
    e2e_automation.py      # Agent #24 — end-to-end capstone (composes existing pipeline)
  spokes/
    hr_agent.py            # Agents #2, #5, #10 — checklist + KT review (LLM)
    checklist_generator_agent.py  # #5 thin traced wrapper around hr_agent
    kt_document_reviewer_agent.py # #10 thin traced wrapper around hr_agent
    it_agent.py            # #3 — IT deprovisioning plan (LLM)
    it_deprovisioning_agent.py    # #18 — execute/verify/audit wrapper (MockITAdapter)
    finance_agent.py       # #4 — finance clearance (deterministic, no LLM)
    exit_intel_agent.py    # #8, #19 — interview analysis + longitudinal trend (LLM)
    risk_agent.py          # #12, #21 — risk scoring (deterministic formula, no LLM)
    rehire_agent.py        # #21 thin wrapper around risk_agent
    compliance_agent.py    # #13 — compliance verification (deterministic)
    doc_collection.py      # #16 — required-docs tracking + OCR validation (real Tesseract)
    email_drafting_agent.py       # #6 — email routing via notifications.py
    smart_routing.py       # #11 tool-node — OOO-aware approver selection
    multi_system_clearance.py     # #15 tool-node — consolidates exit_tasks as stand-in for external systems
  analytics/
    analytics_agent.py     # #14 — HR dashboard insights (LLM narrative over real stats)
    sla_escalation.py      # #9 — overdue task escalation (>5 days, emails real blocker)
    policy_auditor.py      # #22 — policy compliance audit (CLI-only, no scheduler)
    workflow_optimizer.py  # #17 — bottleneck analysis (reuses sla_escalation.find_breaches)
    attrition_agent.py     # #23 — predictive attrition (LLM narrative, department-level proxy)
  core/
    config.py              # Loads .env; creates db (service key); exposes all secret names
    llm.py                 # Single LLM call point: ask_claude() / ask_claude_json()
    trace.py               # @traced_node decorator; log_llm(); log_db(); TRACE_LEVEL env
    prompts.py             # load_prompt() — reads from agents/core/prompts/*.md
    notifications.py       # Gmail SMTP email; dev-safe gate; check_overdue_and_notify()
    calendar_booking.py    # Google Calendar event booking; dev-safe gate
  service.py               # HTTP bridge: 9 routes on localhost:8787
  run_case.py              # CLI entry point: python -m agents.run_case <case_id>
  e2e_test.py              # Smoke test (not a test framework — direct pipeline calls)
  requirements.txt         # langgraph, supabase, python-dotenv, requests, typing_extensions, google-*

src/
  App.jsx                  # Root: auth check, role detection, renders correct dashboard
  routes/
    AppRoutes.jsx           # URL → component mapping; role guards
    employee/
      EmployeeLayout.jsx    # Sidebar shell for employees
      EmployeePages.jsx     # Dashboard, MyExit, Tasks, Documents, ExitInterview, Timeline
    hr/
      HrLayout.jsx
      HrPages.jsx           # All HR pages: AllExits, Escalations, RiskCompliance, Interviews, Trends, Clearances, AgentActivity, PolicyAudit, WorkflowOptimization, Reports, Settings
    manager/
      ManagerLayout.jsx
      ManagerPages.jsx      # Dashboard, MyTeam, ExitingReports, KtApprovals, Clearances, Timeline
    it/
      ItLayout.jsx
      ItPages.jsx           # Dashboard, Deprovisioning, AssetRecovery, AccessReviews, Approvals, AuditLog
    finance/
      FinanceLayout.jsx
      FinancePages.jsx      # Dashboard, dues settlement
    shared/
      Placeholder.jsx
      HelpPage.jsx
  components/
    LoginPage.jsx
    Sidebar.jsx
    PageHead.jsx
    EmployeeGroup.jsx       # Shared HR case-group helpers
    RoleSwitcher.jsx        # Dev-only role switcher (VITE_ENABLE_ROLE_SWITCHER=true)
  lib/
    supabase.js             # Supabase anon-key client (frontend-safe)
    clearanceStatus.js
    format.js
    agentRunText.js
    financeStatus.js
    policyAudit.js
  styles/
    tokens.css              # Design tokens

supabase/
  migrations/              # 0001–0030; authoritative schema source
    0001_schema.sql        # Tables: profiles, exit_cases, exit_tasks, exit_interviews, exit_docs, trend_alerts
    0002_rls.sql           # Row-level security + app_current_role() + restricted views
    0003_rag.sql           # match_exit_docs() function
    0020_role_views_security_invoker.sql  # THE fix for the recurring view-drift issue (see Known Drift)
  functions/
    submit-resignation/index.ts
    ask/index.ts           # RAG assistant; reads PORTKEY_* + ANTHROPIC_* from Edge Function secrets
    forward-to-hr/index.ts

scripts/
  exit_policy.md           # Source document for RAG ingestion
  ingest_docs.js           # Chunk + embed exit_policy.md → exit_docs table (run once)
  seed/
    seed.js                # 103 demo profiles + 15 exit cases
    seed_delegates.js      # One delegate per role (hr.delegate@/manager.delegate@/it.delegate@)
```

---

## The 24 agents — honest state

### Hub
| # | Name | File | Trigger | Honest state |
|---|---|---|---|---|
| 20 | Supervisor / orchestrator | `agents/hub/supervisor.py` | `python -m agents.run_case <case_id>` or via `service.py` routes (per-action) | Real, end-to-end verified |
| 24 | E2E automation capstone | `agents/hub/e2e_automation.py` | Manual CLI: `python -m agents.hub.e2e_automation <case_id>` | Real — composes existing pipeline, no new logic |

### Spokes
| # | Name | File | Trigger | Honest state |
|---|---|---|---|---|
| 2 | HR agent | `spokes/hr_agent.py` | Auto via `service.py /activate-exit` on resignation submit | Real; LLM generates checklist and KT review |
| 5 | Checklist Generator | `spokes/checklist_generator_agent.py` | Same as #2 | Thin traced wrapper around hr_agent |
| 10 | KT Document Reviewer | `spokes/kt_document_reviewer_agent.py` | Via `run_case` with `--kt-text` or supervisor `kt_text` param | Thin traced wrapper around hr_agent |
| 3 | IT agent | `spokes/it_agent.py` | Auto via `service.py /manager-approve` after manager approves KT | Real; LLM generates deprovisioning plan |
| 18 | IT Deprovisioning Execute/Audit | `spokes/it_deprovisioning_agent.py` | Auto via `service.py /execute-deprovisioning` after IT approves task | **MockITAdapter** — simulates execution, writes audit log; does NOT connect to Okta/Jamf/GitHub |
| 4 | Finance agent | `spokes/finance_agent.py` | Auto via `service.py /finance-settle-check` after finance marks dues settled | Real; deterministic, no LLM |
| 8 | Exit-Interview Intelligence | `spokes/exit_intel_agent.py` | Auto via `service.py /submit-exit-interview` after employee submits | Real; LLM produces summary/sentiment/themes/rehire |
| 19 | Longitudinal Trend (attrition themes) | `spokes/exit_intel_agent.py` (longitudinal mode) | Manual CLI: `python -m agents.spokes.exit_intel_agent longitudinal` | Real; no scheduler — CLI-only |
| 12 | Compliance & Risk | `spokes/risk_agent.py` | Auto via `service.py /finance-settle-check` and `run_case` assess stage | Real; **deterministic formula, no LLM** |
| 21 | Rehire Assessment | `spokes/rehire_agent.py` | Same trigger as #12 (thin wrapper) | Thin wrapper reusing risk_agent.score() |
| 13 | Compliance Verification | `spokes/compliance_agent.py` | Auto re-run after every gate action in `service.py` | Real; deterministic keyword + doc check, no LLM |
| 16 | Document Collection | `spokes/doc_collection.py` | Auto via `service.py /validate-document` after employee uploads | Real; **real Tesseract OCR**; requires TESSERACT_PATH or tesseract on PATH |
| 6 | Email Drafting | `spokes/email_drafting_agent.py` | Side-effect of activate_case, KT persist, finance clearance, relieving letter | Real SMTP; dev-safe: logs unless EMAIL_TEST_RECIPIENT set |
| 11 | Smart Routing | `spokes/smart_routing.py` | Tool-node called from supervisor hr/manager/it stage nodes | Real; OOO-aware; real delegate profiles via seed_delegates.js |
| 15 | Multi-System Clearance | `spokes/multi_system_clearance.py` | Tool-node called from supervisor compliance stage node | **Demo stand-in**: queries own exit_tasks/case_documents as labeled proxies for external ITAM/HRMS/Finance. No external system credentials exist |

### Analytics (all CLI-only; no scheduler in this repo)
| # | Name | File | Trigger | Honest state |
|---|---|---|---|---|
| 14 | Analytics / Dashboard Insights | `analytics/analytics_agent.py` | Manual CLI: `python -m agents.analytics.analytics_agent` | Real; LLM narrative over real aggregated stats |
| 9 | SLA Escalation | `analytics/sla_escalation.py` | Manual CLI: `python -m agents.analytics.sla_escalation` | Real; emails actual blocker; >5-day threshold |
| 22 | Policy Compliance Auditor | `analytics/policy_auditor.py` | Manual CLI: `python -m agents.analytics.policy_auditor` | Real checks (SLA breach, missing approval, skipped step); **no scheduler** |
| 17 | Workflow Optimizer | `analytics/workflow_optimizer.py` | Manual CLI: `python -m agents.analytics.workflow_optimizer` | Real bottleneck analysis; reuses sla_escalation.find_breaches |
| 23 | Predictive Attrition | `analytics/attrition_agent.py` | Manual CLI: `python -m agents.analytics.attrition_agent` | Real code; department-level proxy (no individual hire-date data) |

**#1 Manager** = a human dashboard role, not an agent.

---

## GOLDEN RULES — how to work

1. **One item at a time** from blueprint1.md. Don't start an item until the user says `proceed`.
2. **Stop and report after each item.** Run its checks, then:
   - All pass → print exactly ONE line: `<item> complete — all checks passed`, then wait.
   - Any fail → print ONLY the failing check + its exact error. No summaries, no "next steps".
3. **Tick a box only after the user confirms review** — and for anything user-facing, review means verified IN A REAL BROWSER, not "a script passed once".
4. Never merge items, never skip checks, never work ahead.
5. Terminal stays quiet: success = one line; failure = only the failure.

### Playwright / browser testing rules
- Use **scoped locators only**: `page.locator('button', { hasText: '...' })` within a known parent — never `.first()` or `.nth()` unless the element is genuinely a list with a positional meaning.
- Use **disposable cases** for any test that mutates data (creates tasks, updates status, uploads docs). Create via seed or direct Supabase insert; clean up after. **Never mutate the 15 real seeded cases** (Emp001–010 exit cases); they are the stable demo set.
- A Playwright test passing once is not "done" — it must pass on a rerun against a clean state.

---

## NON-NEGOTIABLES

- **Assessment fields are HR-only.** `risk_level`, `risk_score`, `rehire_eligible`, and exit interview `sentiment`/`summary`/`themes` must not be exposed to employee/manager/IT — enforced by RLS + restricted views, not just hidden in the UI.
- **Frontend uses the anon key + RLS only.** The service-role key and any secret (Portkey API key, Gmail app password, Google refresh token) are SERVER-SIDE only — never in the browser bundle, never committed. `.env` stays gitignored.
- **Deployed Edge Functions read their own secrets from the Supabase Edge Function secrets dashboard**, not from the local `.env`. The Python agent service reads the root `.env`. Same secret value often must be set in BOTH places.
- **Arithmetic in code, not the LLM.** Risk scoring, analytics aggregations, compliance checks, finance clearance — all computed in Python/SQL. The LLM only writes narrative.
- **Never "fix" the Supabase Advisor's "Security Definer View" ERROR** for `employee_exit_view`, `manager_case_view`, `it_task_view`, `finance_case_view`, `employee_interview_status_view`. All five intentionally run with `security_invoker = false` so they can see past their base tables' HR-only RLS and expose only their own safe column list. The Advisor's suggested remediation (`security_invoker = on`) is what has broken each dashboard multiple times. If one reports 0 rows, re-run `supabase/migrations/0020_role_views_security_invoker.sql` first.

---

## Known drift issues

### 1. security_invoker view drift (recurring)
The live Supabase database occasionally diverges from `0020_role_views_security_invoker.sql` — Supabase's own tooling or a future migration re-sets the views to `security_invoker = on`, causing 0-row bugs on every non-HR dashboard. **Symptom:** employee/manager/IT/finance dashboard shows no data. **Fix:** re-run migration 0020. **Do not change the views themselves.**

### 2. Doc-path drift after restructure
After the `agents/` restructure into `hub/`, `spokes/`, `core/`, `analytics/` sub-packages, some older docs and references still point to flat paths (e.g. `agents/hr_agent.py`). The real paths are in the file structure table above. `agents_spec.md` and `blueprint1.md` may still have stale paths — fix them in the same change when you encounter drift, don't leave it for later.

---

## ENV var names (names only — never print values)

```
# Supabase
SUPABASE_URL
SUPABASE_ANON_KEY          # Frontend (RLS-scoped)
SUPABASE_SERVICE_KEY       # Server-side only (agents + scripts + Edge Functions)

# LLM gateway (Portkey → Azure OpenAI)
ANTHROPIC_BASE_URL         # Portkey gateway base URL (wire protocol = Anthropic Messages)
ANTHROPIC_API_KEY          # Portkey API key (named ANTHROPIC_* for gateway compat)
ANTHROPIC_MODEL            # Currently: @azure-openai-eus2/gpt-5.6-sol
PORTKEY_BASE_URL           # Same as ANTHROPIC_BASE_URL in practice
PORTKEY_API_KEY            # Same as ANTHROPIC_API_KEY in practice
PORTKEY_VIRTUAL_KEY        # Also used as the embeddings model ID in ingest_docs.js
PORTKEY_WHISPER_VIRTUAL_KEY  # Reserved for Whisper/audio (not yet wired)

# Email
GMAIL_ADDRESS              # aswindevv2005@gmail.com (sender for all agent emails)
GMAIL_APP_PASSWORD
EMAIL_TEST_RECIPIENT       # Unset = dev-log only; set = real SMTP sends

# Calendar
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
GOOGLE_REFRESH_TOKEN
KT_CALENDAR_ID             # Defaults to "primary" if unset

# OCR
TESSERACT_PATH             # Absolute path to tesseract binary when not on PATH
```

---

## Demo accounts

| Role | Email | Password | Notes |
|---|---|---|---|
| Manager | aravidhan@company.com | aravidhan@ | Demo-only; owns cases for Emp001–010 |
| HR | siva@company.com | siva@1 | Demo-only |
| IT | aswin@company.com | aswin@ | Demo-only |
| Finance | anfiacj@gmail.com | anfiacj@ | Demo-only |
| Employees | Emp001–Emp100 via email | `<EmpId>@` e.g. `Emp001@` | Demo-only deterministic passwords — never in prod |

**Seed invariant:** Emp001–010 always have an exit_cases row (resigned). Emp011–100 have no case at seed time — they hit the resignation gate and are redirected to `/employee/resignation`. Any ad-hoc test case created for Emp011+ must be deleted afterward to preserve this invariant.

**Duplicate pair:** `aravidhan@comany.com` / `siva@comany.com` (typo domain) were created by an accidental second `seed.js` run and deleted 2026-09-14. Always pass `DEMO_EMAIL_DOMAIN=company.com` when re-running seed.js's named-account step.

---

## How to run

```bash
# Frontend
npm install
npm run dev                  # Vite dev server → http://localhost:5173

# Agent service (required for resignation submit → checklist + email)
# Must be running alongside the frontend in dev
PYTHONIOENCODING=utf-8 python -m agents.service   # Windows — needed for trace box-drawing chars
# → listens on http://localhost:8787

# Full pipeline for one case (streams live trace to terminal)
PYTHONIOENCODING=utf-8 python -m agents.run_case <case_id>
PYTHONIOENCODING=utf-8 python -m agents.run_case <case_id> --reject
PYTHONIOENCODING=utf-8 python -m agents.run_case <case_id> --kt-text path.txt --interview-text path.txt

# Individual agents (all from repo root, agents/.venv active)
python -m agents.spokes.hr_agent checklist <case_id>
python -m agents.spokes.risk_agent <case_id>
python -m agents.spokes.compliance_agent <case_id>
python -m agents.spokes.doc_collection <case_id>
python -m agents.analytics.analytics_agent
python -m agents.analytics.sla_escalation
python -m agents.analytics.policy_auditor
python -m agents.analytics.workflow_optimizer
python -m agents.hub.e2e_automation <case_id>

# RAG ingestion (run once, or after updating exit_policy.md)
node scripts/ingest_docs.js

# Seed (fresh DB only)
DEMO_EMAIL_DOMAIN=company.com node scripts/seed/seed.js
node scripts/seed/seed_delegates.js
```

---

## Source-of-truth files


- `agents_spec.md` — one spec per agent: does / trigger / reads / writes / verify
- `CLAUDE.md` (this file) — stack, protocol, non-negotiables

Keep all two in sync with the actual repo. Plan-vs-reality drift has caused real bugs — if code and docs disagree, fix the docs in the same change.
