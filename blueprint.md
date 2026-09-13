# blueprint.md — ExitAI build plan

> **Superseded — historical spec only.** `blueprint1.md` is the single source of
> truth for current phase status and remaining work. The `[x] reviewed and
> approved` marks below record the *original* build spec's completion claims;
> several have since been downgraded to PARTIAL / NOT CONFIRMED in
> `blueprint1.md` (e.g. Phase 1, 3, 4, 7, 9 — pending real-browser review). Do
> not treat this file's checkmarks as current status.

This is the execution spec for Claude Code. Work through it **one phase at a
time**, following the protocol in `CLAUDE.md`. After each phase: run its
**Acceptance checks**, print one success line or only the failure, then STOP and
wait for review before ticking the box and moving on.

**Progress**
- [x] Phase 1 — Four dashboards (static, pixel-identical)
- [x] Phase 2 — Supabase schema + seed 100 employees + auth
- [x] Phase 3 — Login, RLS, HR-only columns, role routing
- [x] Phase 4 — Wire dashboards to live data
- [x] Phase 5 — RAG assistant (ExitAI chatbot)
- [x] Phase 6a — Assessment agents (exit-intel, compliance/risk, analytics)
- [x] Phase 6b — Action agents + supervisor (HR, IT, Finance, orchestrator)
- [x] Phase 7 — Email notifications
- [x] Phase 8 — KT calendar scheduling
- [x] Phase 9 — Final integration test + polish

---

## Phase 1 — Four dashboards (static, pixel-identical)

**Goal:** the exact four dashboards from the mockups, rendering standalone in a
Vite app with placeholder data. No backend yet.

**Build**
- Scaffold React + Vite. Install Tabler Icons (`@tabler/icons-webfont`).
- Create `src/styles/tokens.css` defining every design token the mockups use:
  `--surface-1`, `--surface-2`, `--border`, `--border-warning`, `--radius`,
  `--text-primary/secondary/muted/accent/success/warning/danger`,
  `--bg-accent/success/warning/danger`, `--fill-success/info/control`,
  `--on-success`. Provide light + dark values via `prefers-color-scheme`.
- Build components: `EmployeeDashboard`, `HrDashboard`, `ManagerDashboard`,
  `ItDashboard` — matching the provided mockups exactly (sidebar, header,
  cards, tables, gauge, timeline, chatbot strip). Hardcoded placeholder data.
- Add a dev-only `RoleSwitcher` (top-right) to flip between the four.

**Acceptance checks**
1. `npm run dev` starts with no console errors.
2. All four dashboards render and visually match the mockups (sidebar labels,
   card layout, colors, icons).
3. Only the HR dashboard shows risk scores and trend alerts.
4. No network/Supabase calls exist yet.

- [x] Phase 1 reviewed and approved

---

## Phase 2 — Supabase schema + seed 100 employees + auth

**Goal:** all tables created via migration, 100 fake employees seeded, auth users
created for every login.

**Build (use Supabase MCP)**
- Apply `supabase/migrations/0001_schema.sql` (tables + indexes) and
  `supabase/migrations/0003_rag.sql` (`match_exit_docs` RPC), in that order.
  The SQL is authoritative there - do not restate or re-derive it here.
- Lower Auth min password length to 5 (demo-only; note in README).
- Seed script `scripts/seed.js` (uses SERVICE_KEY, run locally):
  - 100 employees `Emp001`..`Emp100`: name, employee_id, email
    (`<empid>@$DEMO_EMAIL_DOMAIN`), department, role_title, manager + manager
    email, HR + HR email.
  - Create an auth user for each with password `<EmpId>@`; insert a matching
    `profiles` row (role `employee`, linked `employee_id`).
  - Create the three named accounts and their profiles:
    Aravidhan (manager, `aravidhan@`), Siva (hr, `siva@`), Aswin (it, `aswin@`).
  - Create one `exit_cases` row + a realistic set of `exit_tasks` for a subset
    of employees so the dashboards have content.

**Acceptance checks**
1. `select count(*) from profiles` returns 103 (100 + 3 named).
2. Auth sign-in succeeds as `Emp001@$DEMO_EMAIL_DOMAIN` / `Emp001@`.
3. Auth sign-in succeeds as Siva, Aravidhan, Aswin with their passwords.
4. `exit_tasks` has rows for at least one case.

- [x] Phase 2 reviewed and approved

---

## Phase 3 — Login, RLS, HR-only columns, role routing

**Goal:** real login; the database enforces who sees what; each role lands on its
own dashboard.

**Build**
- Login page using Supabase Auth (email + password). Session persisted.
- Apply `supabase/migrations/0002_rls.sql`. It is the authoritative
  access-control model - `app_current_role()`, RLS on every table, the
  HR-only `exit_cases` policy, the two restricted views, the `exit_tasks`
  per-role policies, and the deliberate no-policy posture on `exit_docs`.
  Read that file for the rules and the reasoning; do not duplicate them here.
- After login, route by `profiles.role` to the correct dashboard. Remove the dev
  RoleSwitcher from production build (keep behind a dev flag).

**Acceptance checks**
1. Logging in as Siva -> HR dashboard; Aravidhan -> manager; Aswin -> IT;
   Emp001 -> employee.
2. As an employee, a direct query for `risk_score` returns no rows / permission
   denied (prove the column is unreachable, not just hidden).
3. As a manager, `manager_case_view` returns only their own reports.
4. As IT, `exit_tasks` query returns only `stage='it'` rows.

- [x] Phase 3 reviewed and approved

---

## Phase 4 — Wire dashboards to live data

**Goal:** replace every hardcoded value with a real Supabase query. The old
`78%` becomes a computed number.

**Build**
- Employee: fetch own case + own tasks; progress = `done / total` tasks; render
  checklist, deadlines, timeline from data.
- HR: fetch all cases (with assessment columns), KPI counts, department chart,
  trend alerts (may be empty until Phase 6a — that's expected).
- Manager: `manager_case_view` + reports' tasks + KT approvals.
- IT: `stage='it'` pending tasks as the deprovisioning queue.
- All reads use the anon key + RLS. No service key in frontend.

**Acceptance checks**
1. Employee progress ring reflects actual task counts (change a task's status ->
   number changes on refresh).
2. HR KPI cards equal `count(*)` queries on the data.
3. No hardcoded business data remains in the four dashboards.
4. No service-role key present anywhere in `src/` or the built bundle.

- [x] Phase 4 reviewed and approved

---

## Phase 5 — RAG assistant (ExitAI chatbot)

**Goal:** the "Ask" button answers exit-process questions from real docs, with
citations; refuses when the answer isn't in the docs.

**Vector database:** pgvector, inside the existing Supabase Postgres. This IS the
vector DB — no separate service. Chosen deliberately: one datastore, one
connection, no extra key/bill, and it scales far past this project's needs.
Swap path (only if you later need billions of vectors or hybrid search): move the
`exit_docs` store to Qdrant (open-source, runs in Docker, free) and change the
ingest + retrieve calls; the RAG logic and `/ask` interface stay identical.

**Build**
- pgvector store (`exit_docs`, `vector(1536)`) + `match_exit_docs` cosine-similarity
  function (already specified). Confirm the `vector` extension is enabled and an
  HNSW index exists on the embedding column.
- Ingest script: chunk + embed the exit-policy docs into `exit_docs`. Use the
  SAME embedding model (OpenAI text-embedding-3-small) for ingest and query;
  dimension must match `vector(1536)`.
- `/ask` as a Supabase Edge Function (or small FastAPI service): embed question,
  retrieve top-k via `match_exit_docs`, Claude answers using ONLY the retrieved
  context, returns answer + sources.
- Wire the employee dashboard "Ask" button to `/ask`; render the answer and a
  `Source: <section>` line in the chat card.

**Acceptance checks**
1. The `vector` extension is enabled and `exit_docs` has an HNSW index.
2. "When do I get my final settlement?" -> correct answer citing the settlement
   section, with a non-empty `sources` list.
3. An out-of-scope question -> "I don't have that information, contact HR"
   (no hallucination).
4. Question and documents are embedded with the same model (no dimension
   mismatch errors on insert or query).

- [x] Phase 5 reviewed and approved

---

## The nine agents (reference)

Every agent below maps to our architecture. Each is a compiled LangGraph
subgraph, invoked by the supervisor as a single node. Where a job is really a
tool call (not reasoning), it's a tool on an agent, not its own agent.

| # | Agent | Reads | Writes / does | Dashboard it feeds |
|---|-------|-------|---------------|--------------------|
| 1 | Supervisor / orchestrator | case state | routes, handles exceptions | (all) |
| 2 | HR agent | role, department | generates checklist, reviews KT, checks docs | Employee, Manager |
| 3 | IT agent | case | generates deprovisioning plan (human-approved) | IT |
| 4 | Finance agent | case | verifies financial clearance (tool call) | HR, IT queue |
| 5 | Notification agent | task/stage events | stage emails (Phase 7) | (all) |
| 6 | FAQ / RAG chatbot | exit_docs | answers with citations (Phase 5) | Employee |
| 7 | Exit-interview intelligence | exit_interviews | summary, sentiment, themes, rehire, trends | HR |
| 8 | Compliance & risk | case, tasks | risk_level, risk_score, rehire_eligible | HR |
| 9 | Analytics | historical cases/tasks | bottleneck + attrition narratives | HR |

Agents 5 and 6 are built in Phases 7 and 5. The rest are Phases 6a and 6b below.

**Seed vs generate:** Phase 2 seeds checklist tasks so the dashboards have data
early. The HR agent (Phase 6b) is what *generates* a checklist from an employee's
role for real. Both coexist: seeding is demo scaffolding; the agent is the
capability. When the HR agent runs on a new case, it creates the tasks itself.

---

## Phase 6a — Assessment agents (fill the HR dashboard)

**Goal:** the agents that turn raw exit data into the assessments HR sees. These
produce the risk scores, summaries, and trends that were placeholders in Phase 4.

**Build**
- **Exit-Interview Intelligence agent** (#7): compiled LangGraph subgraph, two
  modes. Per-case -> writes summary, sentiment, themes, rehire fields to
  `exit_interviews`. Longitudinal -> writes rising-theme rows to `trend_alerts`.
  (Code already specified — drop it in.)
- **Compliance & Risk agent** (#8): scores a case from tenure, role criticality,
  interview sentiment, and outstanding tasks -> writes `risk_level`,
  `risk_score`, `rehire_eligible` on `exit_cases`.
- **Analytics agent** (#9): scheduled job. Aggregates historical cases/tasks in
  plain SQL/Python (NOT the LLM), then the LLM writes a short narrative of
  bottlenecks and attrition signals. Store narratives for the HR "insights" panel.
- Scheduled trigger (Supabase cron / Edge Function) for the longitudinal +
  analytics runs.

**Acceptance checks**
1. Submitting an exit interview populates summary + sentiment on that row, and
   the HR dashboard shows them.
2. The risk fields populate on the case and appear in the HR "Risk (agent)"
   column — no longer placeholder.
3. Longitudinal mode inserts >=1 `trend_alerts` row, visible in HR "Trend alerts".
4. The analytics job produces a narrative from seeded data (arithmetic done in
   code, not the LLM).

- [x] Phase 6a reviewed and approved

---

## Phase 6b — Action agents + supervisor (drive the workflow)

**Goal:** the agents that *do* things in the process, coordinated by the
supervisor. These make the "agent-generated" labels on the Employee, Manager,
and IT dashboards real.

**Build**
- **HR agent** (#2): given a new case (role, department), generates the exit
  checklist as `exit_tasks`; reviews an uploaded KT document for completeness and
  writes gap findings. Employee sees gaps as actionable to-dos; the manager sees
  the KT-review summary (the same finding, framed per role — never an evaluation
  leaked to the employee).
- **IT agent** (#3): generates a deprovisioning plan (accounts to disable, access
  to revoke, assets to collect) as IT-stage `exit_tasks`. Execution is
  human-in-the-loop: nothing irreversible runs until IT clicks approve.
- **Finance agent** (#4): lighter — a tool-using node that checks financial
  clearance (dues, reimbursements) and marks the finance stage. Not a heavy
  reasoning agent; keep it a tool call the supervisor invokes.
- **Supervisor / orchestrator** (#1): a top-level LangGraph whose nodes are the
  compiled agent subgraphs above (and the 6a agents). Holds one case state,
  routes to the right agent per stage, and has explicit branches for exceptions
  (rejection, re-route when an approver is out, escalation).

**Acceptance checks**
1. Running the HR agent on a fresh case generates a role-appropriate checklist in
   `exit_tasks` (not the seeded set).
2. The KT-review gap findings appear as employee to-dos AND as the manager's
   KT-review summary — and the employee view never exposes the evaluative framing.
3. Running the IT agent produces a deprovisioning plan visible in the IT queue,
   all items `pending` until approved (no auto-execution).
4. The supervisor runs one case end to end across stages, and a simulated
   rejection triggers its re-route/escalation branch instead of crashing.

- [x] Phase 6b reviewed and approved

---

## Phase 7 — Email notifications

**Goal:** stage-based emails from one sender account.

**Build**
- `notifications` module using `EMAIL_API_KEY` + `EMAIL_SENDER` (provider-agnostic).
- Templates: KT reminder, overdue-clearance warning, completion notice.
- Trigger points: task becomes overdue; clearance completes; KT scheduled.
- Dev mode logs the email instead of sending unless a test recipient is set.

**Acceptance checks**
1. Triggering a notification sends (or logs) an email from the single sender.
2. A test send to one real address arrives.
3. No secrets committed; keys read from env.

- [x] Phase 7 reviewed and approved

---

## Phase 8 — KT calendar scheduling

**Goal:** KT sessions become calendar events.

**Build**
- Calendar module using `CALENDAR_API_KEY`.
- Creating/booking a KT task creates a calendar event for the employee + manager;
  store the event id on the task.

**Acceptance checks** q
1. Booking a KT slot creates a calendar event and returns its id.
2. The event id is persisted on the task.

- [x] Phase 8 reviewed and approved

---

## Phase 9 — Final integration test + polish

**Goal:** one clean end-to-end run of a full exit.

**Build**
- End-to-end script: create a new exit -> tasks generated -> employee completes
  items -> agents assess -> HR sees risk/trends -> notifications fire ->
  clearance completes.
- `README.md` with setup, the security note, and demo logins.
- One integration test that runs the whole flow and prints a single success line,
  or only the first failing step.

**Acceptance checks**
1. The end-to-end script completes without error.
2. Each role dashboard shows correct, live data at the end of the run.
3. README documents setup + demo accounts + the deterministic-password caveat.

- [x] Phase 9 reviewed and approved
