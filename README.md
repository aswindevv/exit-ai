# ExitAI

ExitAI — AI-powered employee offboarding with a 24-agent hub-and-spoke system.

## Overview

Employee offboarding often spans disconnected HR, manager, IT, finance, and compliance work, making progress difficult to track and easy to delay. ExitAI brings those stages into one role-based application backed by a shared case record and auditable task history. A LangGraph supervisor coordinates case-level agents, while human users retain control of approvals, deprovisioning, dues settlement, and final relieving. The repository also includes policy-grounded Q&A, document OCR, email and calendar integrations, risk analysis, and on-demand operational analytics.

## Workflow

![ExitAI AI-powered employee offboarding workflow showing a 24-agent LangGraph hub-and-spoke system. A supervisor orchestrator routes a resignation through seven stages: Resignation, HR and checklist, Manager, IT clearance, Compliance, Finance, and Relieving, with human gates at manager, IT, finance, and relieving. Supporting sections list Communication with Email drafting, SLA escalation, and FAQ chatbot RAG; Intelligence with Exit interview summarizer, Risk assessment, Rehire assessment, and Trend analyst; Analytics and audit with Dashboard insights, Workflow optimizer, Policy auditor, and Predictive attrition; and Access and security with 5 role dashboards, Row Level Security RLS, HR-only risk and sentiment, and Full agent audit trail. The tech stack lists LangGraph, Google Gemini 3.5 Flash-Lite, Portkey, Supabase Postgres, pgvector, Tesseract, Gmail, and Calendar. The diagram has a clear, structured, professional tone.](docs/ExitAI_workflow.jpeg)

## Architecture

ExitAI uses a LangGraph hub-and-spoke design: agents do not hand work directly to one another; the supervisor owns case state and invokes the relevant spoke.

```text
Resignation
    -> HR activation and personalized checklist
    -> Manager KT approval [HUMAN GATE]
    -> IT clearance and execution [HUMAN GATE]
    -> Compliance verification
    -> Finance dues settlement [HUMAN GATE]
    -> HR relieving-letter issue [HUMAN GATE]
```

The compiled supervisor graph itself runs `HR -> manager gate -> IT -> compliance -> finance -> assessment`. Resignation creation happens first through the `submit-resignation` Edge Function, and the relieving letter is issued afterward by HR in the UI; neither is a supervisor node. A manager rejection branches to an HR escalation and stops the graph before IT and finance. The browser flow waits for real approvals, while the CLI case runner approves the manager gate by default unless it is run with `--reject`.

## Agents

The catalog below follows [`docs/agent_requirements.md`](docs/agent_requirements.md). These are 24 named capabilities, not 24 independent LLM processes: some are deterministic, some reuse another agent through a traced wrapper, one is a human gate, and scheduled-style analytics currently run only when invoked from the CLI.

Status meanings: **working** is wired into a case, event, or request path; **manual** is implemented but must be invoked explicitly; **demo-scale** uses a deliberate stand-in for an external production dependency.

| Agent | What it does | Trigger | Status |
|---|---|---|---|
| 1. Manager Agent | Represents the manager decision point for KT approval or rejection; this is a human role, not an LLM. | On approval | Working |
| 2. HR Agent | Generates the HR/manager checklist and reviews supplied KT text, persisting tasks and review results. | Per case | Working |
| 3. IT Agent | Generates role-aware deprovisioning tasks after the manager gate opens. | On approval | Working |
| 4. Finance Agent | Clears the finance stage only after prior stages are done and Finance has marked dues settled. | On approval | Working |
| 5. Exit Checklist Generator Agent | Exposes the HR checklist generator as a named, traced agent for role- and department-specific tasks. | Per case | Working |
| 6. Email Drafting Agent | Produces stage-specific resignation, reminder, escalation, completion, document, and relieving-letter messages. | Per-case event | Working |
| 7. FAQ Chatbot for Exit Process | Answers employee questions through RAG over the exit-policy corpus and returns source sections. | Per question | Working |
| 8. Exit Interview Summarizer | Converts an interview submission into a summary, sentiment, themes, recommendations, and rehire inputs. | Per case / on submission | Working |
| 9. SLA Escalation Agent | Finds pending tasks at least five days overdue and drafts escalation notices naming the blocker. | Manual CLI; also case-scoped in capstone | Manual |
| 10. KT Document Reviewer Agent | Reviews supplied KT text for role-specific gaps and creates follow-up tasks. | Per case with KT text | Working |
| 11. Smart Routing Agent | Selects an available HR, manager, or IT approver using department, out-of-office, and delegate data. | Per case | Working |
| 12. Exit Risk Assessment Agent | Computes a deterministic weighted risk score and mitigation data from the case, profile, interview, and tasks. | Per case / finance approval | Working |
| 13. Compliance Verification Agent | Checks manager approval, asset/NDA evidence, IT revocation, and finance state before clearance. | Per case / on approval | Working |
| 14. Dashboard Insights Agent | Aggregates case and task metrics in Python, then generates and stores an HR narrative. | Manual CLI | Manual |
| 15. Multi-System Clearance Agent | Consolidates IT, HRMS, finance, and document status from local Supabase stand-in data. | Per case | Demo-scale |
| 16. Document Collection Agent | Determines required documents, tracks missing uploads, sends reminders, and validates uploaded images with OCR rules. | On upload; full scan via CLI | Working |
| 17. Exit Workflow Optimizer Agent | Analyzes overdue-stage and department bottlenecks and stores recommendations. | Manual CLI | Manual |
| 18. Automated IT Deprovisioning Agent | Reuses the IT plan generator, then simulates execution through a mock IT adapter and audits only human-approved tasks. | On manager and IT approval | Demo-scale |
| 19. Exit Interview Trend Analyst Agent | Counts repeated themes across interviews and writes deduplicated department or organization alerts. | Manual CLI | Manual |
| 20. Exit Process Orchestrator (Multi-Agent) | Runs the LangGraph case flow, records handoffs, and branches rejected manager decisions to escalation. | Per case / CLI | Working |
| 21. Intelligent Rehire Assessment Agent | Wraps the risk assessment, adds confidence/evidence, and records an independent rehire assessment. | Manual CLI | Manual |
| 22. Policy Compliance Auditor Agent | Audits active cases for SLA breaches, missing approvals, and skipped steps, then stores a report. | Manual CLI | Manual |
| 23. Predictive Attrition Agent | Combines case risk and trend signals into at-risk departments and retention suggestions. | Manual CLI | Manual |
| 24. End-to-End Exit Automation Agent | Composes activation, supervisor routing, case-scoped SLA checks, and final clearance into one capstone run. | Manual CLI | Manual |

## Retrieval-Augmented Generation

Policy content is chunked by `scripts/ingest_docs.js`, embedded with OpenAI `text-embedding-3-small` through the Portkey embeddings route, and stored in the `exit_docs.embedding vector(1536)` column. PostgreSQL uses an HNSW cosine index, and `match_exit_docs` returns the four closest chunks for a query embedding.

The Supabase `/ask` Edge Function embeds each question, calls `match_exit_docs`, and sends the retrieved context to the configured Gemini 3.5 Flash-Lite route through Portkey. It returns the answer and the source sections actually used; unrelated questions can be refused, and general employment guidance is kept distinct from company policy.

pgvector keeps source text, embeddings, access controls, and application data in the existing Supabase Postgres deployment. That avoids operating and synchronizing a separate vector database, while RLS leaves `exit_docs` inaccessible to browser clients and makes the service-role `/ask` function the controlled retrieval boundary.

## Tech Stack

- **Orchestration:** LangGraph hub-and-spoke graphs in Python
- **LLM:** Google Gemini 3.5 Flash-Lite through the Portkey gateway; the project migrated from Anthropic Claude Sonnet → Azure OpenAI GPT → Gemini 3.5 Flash-Lite over time; the retained `ANTHROPIC_*` env-var names describe the compatible Messages API wire format, not the vendor
- **Backend:** Supabase Postgres, Auth, Row Level Security, pgvector, Edge Functions, and private Storage
- **Agent runtime:** Python service plus CLI entry points
- **Frontend:** React 18, Vite, React Router, and Supabase JS
- **Documents:** Tesseract OCR through `pytesseract` and Pillow
- **Notifications:** Gmail SMTP
- **Scheduling integration:** Google Calendar OAuth using one shared demo calendar configuration

## Roles and Security

ExitAI has five application roles:

| Role | Main responsibility |
|---|---|
| Employee | Submit a resignation, follow tasks, upload documents, complete the exit interview, and ask policy questions. |
| HR | Manage cases, escalations, risk/compliance, interviews, reports, and final relieving. |
| Manager | Review KT tasks and approve or reject the manager clearance gate. |
| IT | Approve deprovisioning work, recover assets, and verify execution. |
| Finance | Confirm or reject final-dues settlement through role-checked database functions. |

Supabase Auth identifies the user, and RLS scopes rows and write operations by role. The browser uses only the anon key; service-role credentials remain in server-side scripts, the Python service, and Edge Functions. `risk_level`, `risk_score`, `rehire_eligible`, and exit-interview sentiment/summary data are protected at the database level: non-HR roles have no read policy on the base case/interview tables and receive only fixed safe columns through restricted views.

## Project Structure

```text
agents/                         Python agents, shared integrations, analytics, and hub graphs
├── hub/supervisor.py           LangGraph case supervisor and approval/rejection routing
├── service.py                  Local stdlib HTTP bridge used by the React app
├── spokes/                     Case-level HR, IT, finance, compliance, risk, OCR, and routing agents
└── analytics/                  On-demand SLA, audit, insights, optimization, and attrition jobs
src/routes/                     Role-specific React pages for Employee, HR, Manager, IT, and Finance
supabase/functions/             RAG, resignation, and HR-forwarding Edge Functions
supabase/migrations/            Ordered schema, RLS, view, RPC, Storage, and agent-run migrations
docs/                           Agent requirements and project documentation
agents_spec.md                  Implementation mapping and evidence for all 24 agents
```

## Getting Started

### Prerequisites

- Node.js 20.12+ and npm (`process.loadEnvFile()` is used by the data scripts)
- Python 3.10+
- Tesseract OCR installed and either on `PATH` or supplied through `TESSERACT_PATH`
- A Supabase project and Supabase CLI for applying migrations and deploying Edge Functions

### Install

```bash
npm install

python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r agents/requirements.txt
python -m pip install pytesseract Pillow
```

`doc_collection.py` imports `pytesseract` and Pillow, but those two packages are not currently listed in `agents/requirements.txt`, so they are installed explicitly above.

Apply every SQL file in `supabase/migrations/` in numeric order, then deploy the `ask`, `submit-resignation`, and `forward-to-hr` Edge Functions. To populate the RAG corpus after the database and gateway are configured, run:

```bash
node scripts/ingest_docs.js
```

Optional synthetic seed data can be created with `npm run seed`. The seed script uses the backend service key and must never be run in the browser.

### Environment Variables

Create a root `.env` for the frontend, scripts, and Python service. Use your own values; do not commit this file.

```dotenv
# Browser-safe Vite variables
VITE_SUPABASE_URL=<supabase-url>
VITE_SUPABASE_ANON_KEY=<supabase-anon-key>
VITE_ENABLE_ROLE_SWITCHER=<true-or-false>

# Backend scripts and Python agents
SUPABASE_URL=<supabase-url>
SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_KEY=<supabase-service-role-key>
ANTHROPIC_BASE_URL=<portkey-messages-endpoint>
ANTHROPIC_API_KEY=<portkey-api-key>
ANTHROPIC_MODEL=<gemini-model-route>
PORTKEY_BASE_URL=<portkey-api-base-url>
PORTKEY_API_KEY=<portkey-api-key>
PORTKEY_VIRTUAL_KEY=<embedding-model-route>

# Email
GMAIL_ADDRESS=<sender-address>
GMAIL_APP_PASSWORD=<gmail-app-password>
EMAIL_TEST_RECIPIENT=<optional-send-enable-value>

# Google Calendar
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=<oauth-redirect-url>
GOOGLE_REFRESH_TOKEN=<google-oauth-refresh-token>
KT_CALENDAR_ID=<calendar-id>

# Optional local/runtime settings
TESSERACT_PATH=<tesseract-executable-path>
TRACE_LEVEL=<full-summary-or-off>
DEMO_EMAIL_DOMAIN=<synthetic-demo-domain>
```

Configure these names as Supabase Edge Function secrets where the functions require them:

```dotenv
SUPABASE_URL=<supabase-url>
SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
PORTKEY_BASE_URL=<portkey-api-base-url>
PORTKEY_API_KEY=<portkey-api-key>
PORTKEY_VIRTUAL_KEY=<embedding-model-route>
ANTHROPIC_BASE_URL=<portkey-messages-endpoint>
ANTHROPIC_API_KEY=<portkey-api-key>
ANTHROPIC_MODEL=<gemini-model-route>
EMAIL_SENDER=<sender-address>
EMAIL_APP_PASSWORD=<email-app-password>
HR_FORWARD_EMAIL=<hr-address>
```

Never expose `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, gateway credentials, email credentials, or OAuth tokens through `VITE_*` variables.

### Run

Start the frontend:

```bash
npm run dev
```

In a second terminal, activate the Python environment and start the local agent bridge on `http://localhost:8787`:

```bash
python -m agents.service
```

Run one existing case directly through the CLI supervisor:

```bash
python -m agents.run_case <case_id>
```

The bare CLI command supplies bundled demo KT/interview text and treats the manager gate as approved. Use the browser workflow for real human approvals, or pass `--reject` to exercise the rejection branch.

## Known Limitations

- Scheduled-style agents run through manual CLI commands; there is no scheduler or cron integration yet.
- Multi-System Clearance uses live ExitAI data as a stand-in; it does not call real IT asset-management, HRMS, or finance APIs.
- Automated IT Deprovisioning uses a mock provider adapter; it does not disable accounts or call Okta, Jamf, Google Workspace, or another real IT system.
- OCR verifies expected keywords, employee identity text, and a date are present; it does not authenticate a handwritten or digital signature.
- The local agent service uses Python's built-in `ThreadingHTTPServer`, not FastAPI or another production application server.
- Email sends and Calendar writes require their integrations to be configured; otherwise the Python helpers log the intended action.

## Future Improvements

- Add a scheduler for SLA escalation, policy audits, dashboard insights, trend analysis, workflow optimization, and attrition jobs.
- Replace Multi-System Clearance stand-ins with authenticated external system adapters.
- Add `completed_at` timestamps so stage duration and completion reporting do not rely only on creation/due dates.
- Define and enforce a data-retention policy for case records, interviews, uploaded documents, messages, and agent traces.

## Credits

Built during an AI internship at Perficient.
