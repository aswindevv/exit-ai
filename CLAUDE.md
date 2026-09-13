# CLAUDE.md — Exit AI

Project memory for Claude Code. Read this fully before doing anything.

## What Exit AI is
An AI-assisted employee offboarding platform. Four role-based dashboards
(Employee, HR, Manager, IT) over Supabase, a RAG assistant, and a **multi-agent
system** that assesses and drives each exit.

## Stack (authoritative — do not drift)
- **LangGraph** — agent framework. NOT CrewAI.
- **Hub-and-spoke** — the architecture PATTERN: a Supervisor hub routes to agent
  spokes; spokes coordinate ONLY through the hub, never each other. NOT HubSpot
  (there is no HubSpot / CRM in this project).
- **Supabase** — Postgres, Auth, RLS, pgvector (RAG store), agent state.
- **Portkey gateway** — LLM access (Azure OpenAI embeddings, Anthropic/Bedrock
  generation) via virtual keys.
- Frontend: React + Vite, design tokens in src/styles/tokens.css, Tabler icons.
- Agents: Python service in /agents (venv), each node @traced_node-wrapped.

## Source-of-truth files
- `blueprint1.md` — current plan: real phase status + remaining work (A–E).
- `agents_spec.md` — one spec per agent: does / trigger / reads / writes / verify.
- This file — stack, protocol, non-negotiables.
Keep these three in sync with the actual repo. Plan-vs-reality drift has caused real
bugs here — if code and docs disagree, fix the docs in the same change.

---

## GOLDEN RULES — how to work
1. **One item at a time** from blueprint1.md. Don't start an item until the user says
   `proceed`.
2. **Stop and report after each item.** Run its checks, then:
   - All pass → print exactly ONE line: `<item> complete — all checks passed`, then wait.
   - Any fail → print ONLY the failing check + its exact error. No summaries, no
     "next steps", no apologies.
3. **Tick a box only after the user confirms review** — and for anything user-facing,
   review means verified IN A REAL BROWSER, not "a script passed once".
4. Never merge items, never skip checks, never work ahead.
5. Terminal stays quiet: success = one line; failure = only the failure.

## Agents must be visible in the terminal
Every agent is @traced_node-wrapped. There is a runnable entry point
(`python -m agents.run_case <case_id>`) that streams the live trace: each spoke's
start, inputs, LLM call (model + latency + tokens), DB writes, output, and total time,
indented under the hub so hub→spoke→hub handoffs are visible in order. Don't claim an
agent "works" unless its trace and written output were actually seen.

---

## NON-NEGOTIABLES
- **UI matches the approved design.** Don't redesign the dashboards; only wire/fix.
- **Frontend uses the anon key + RLS only.** The service-role key and any secret
  (Portkey, Gmail app password, Google refresh token) are SERVER-SIDE only — never in
  the browser bundle, never committed. `.env` stays gitignored.
- **Assessment fields are HR-only.** risk_level, risk_score, rehire_eligible, and
  interview sentiment/summary must not be exposed to employee/manager/IT — enforced by
  RLS + restricted views, not just hidden in the UI.
- **Deployed functions don't read local .env.** Secrets for Edge Functions must be set
  as Edge Function secrets in the Supabase dashboard; the Python agent service reads
  its own env. Same secret often must be set in more than one place.
- **Arithmetic in code, not the LLM.** Analytics/aggregations compute counts in
  SQL/Python; the LLM only writes narrative.

## ENV / SECRETS (names only; never print values)
Supabase: SUPABASE_URL, SUPABASE_ANON_KEY (frontend), SUPABASE_SERVICE_KEY (server).
LLM gateway: PORTKEY_BASE_URL, PORTKEY_API_KEY, PORTKEY_VIRTUAL_KEY,
ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, OPENAI (embeddings) as configured.
Email: EMAIL_SENDER, EMAIL_APP_PASSWORD, HR_FORWARD_EMAIL, EMAIL_TEST_RECIPIENT.
Calendar: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, KT_CALENDAR_ID.
All secrets: server-side only, gitignored, revocable.

## Current state (from status report — keep honest)
Built: schema+seed (103 profiles), RLS, RAG assistant, Phase 6a/6b agents (supervisor +
HR/IT/Finance/Risk/Exit-Interview run end-to-end), calendar (real events).
Partial: dashboards (dead action buttons), email (dev-logged, not delivered).
Not confirmed: Phase 9 end-to-end BROWSER review; per-agent individual verification.

## Remaining work (see blueprint1.md A–E, in order)
A1 wire dead action buttons → A2 nav router+pages → B1 terminal-trace entry point +
per-agent verification → C1 real email delivery → D drift cleanup (blueprint
consistency, missing it_task_view migration) → E1 real-browser end-to-end review →
then tick Phase 9.

## Demo accounts
Manager Aravidhan · HR Siva · IT Aswin · Employees Emp001–100 (login by email,
password `<EmpId>@`). Deterministic passwords are DEMO-ONLY (fake data); never in prod.

## Run
- Frontend: `npm install` && `npm run dev`.
- Agents: activate agents/.venv, then `python -m agents.run_case <case_id>` or
  `python agents/e2e_test.py`.
- Agent service (required for resignation submit to generate a checklist +
  manager email live): from repo root, `PYTHONIOENCODING=utf-8` on Windows,
  `python -m agents.service` — listens on localhost:8787, called by the
  frontend right after submit-resignation creates the case.
