# blueprint.md — Exit AI

Stack: **LangGraph** (agent framework) · **hub-and-spoke** (architecture pattern:
supervisor hub + agent spokes) · **Supabase** (Postgres, Auth, RLS, pgvector) ·
**Portkey gateway** (LLM access). No CrewAI. No HubSpot.

Protocol (see CLAUDE.md): work one item at a time, run its checks, print one success
line or only the failure, then STOP for review. Tick a box only after the user
confirms review in a real browser — a script passing once is not "done".

---

## Architecture — hub and spokes

- **Hub:** Supervisor agent — routes each exit case to the spokes, waits for all
  clearance gates, handles exceptions (rejection, re-route, escalation).
- **Spokes (agents), coordinate ONLY through the hub, never each other:**
  - Clearance: HR, IT, Finance
  - Communication: Notification, FAQ chatbot (RAG)
  - Intelligence: Exit-Interview, Compliance & Risk, Analytics
- 24 required capabilities are delivered by ~10 agents — several cover multiple
  capabilities through different triggers/modes (see mapping below), rather than
  duplicating agents.

### 24 capabilities → agents (mapping)
- HR agent ← #2, #5 checklist, #10 KT review, #16 doc collection (doc_collection.py, required-vs-submitted tracking + reminders via notifications._compose/_send, real OCR validation via pytesseract + Tesseract binary)
- IT agent ← #3, #18 deprovisioning
- Finance agent ← #4
- Notification agent ← #6 email drafting, #9 SLA escalation (sla_escalation.py, reuses notifications._compose/_send, >5-day threshold, escalates to the real blocker)
- FAQ chatbot ← #7 (built as RAG)
- Exit-Interview agent ← #8, #19 trend analyst (longitudinal mode)
- Risk agent ← #12; #21 rehire is its own thin-wrapper module (rehire_agent.py)
- Compliance agent ← #13 (compliance_agent.py, real blocking logic), #22 policy auditor (policy_auditor.py, scheduled -- reuses sla_escalation.find_breaches plus its own missing_approval/skipped_step checks)
- Analytics agent ← #14 (analytics_agent.py), #17 optimizer (workflow_optimizer.py, reuses analytics_agent's aggregate node), #23 attrition (attrition_agent.py, department-level proxy -- see its ponytail comment)
- Supervisor ← #20 orchestrator, #24 end-to-end capstone
- Tool-nodes (not standalone agents, called from existing supervisor.py stage nodes): #11 smart routing (smart_routing.py, real department + out_of_office routing over profiles, routes to a real delegate profile via scripts/seed_delegates.js — called from the hr/manager/it stage nodes), #15 multi-system clearance (multi_system_clearance.py, consolidates exit_tasks/case_documents as a labeled demo stand-in for IT asset mgmt/HRMS/finance — called from the compliance stage node)
- #1 Manager = a human role in the dashboard, not an agent

---

## Current state (from status report — real, not aspirational)

**Progress**
- [x] Phase 1 — Four dashboards ..................... PARTIAL (dead action buttons)
- [x] Phase 2 — Schema + seed (103 profiles) ....... BUILT
- [x] Phase 3 — Login / RLS / routing .............. BUILT (not browser-verified)
- [x] Phase 4 — Live data wiring ................... PARTIAL (no-op buttons on top)
- [x] Phase 5 — RAG assistant ...................... BUILT (deployed, not re-tested)
- [x] Phase 6a — Assessment agents ................. BUILT (e2e run wrote real data)
- [x] Phase 6b — Action agents + supervisor ........ BUILT (supervisor.run_case works)
- [~] Phase 7 — Email notifications ................ PARTIAL (dev-logged, not delivered)
- [x] Phase 8 — KT calendar ........................ BUILT (real event + id saved)
- [x] Phase 9 — Final integration / review ......... NOT CONFIRMED (needs browser review)
- [x] Phase 10 — Finance clearance role ............ BUILT (real dues check, browser-verified)
- [x] Phase 11 — End-to-end automation capstone .... BUILT (composition, trace-verified)

Legend: [x] built  ·  [~] partial  ·  [ ] not done/unconfirmed

---

## What's LEFT to do (the real remaining work)

### A. Frontend wiring — make the UI reflect the working backend (HIGHEST VALUE)
- [x] A1. Wire dead action buttons to real backend actions:
      Manager "Review"/"Sign" (currently onClick={() => {}}), IT action button.
      Action updates Supabase (respecting RLS); UI refreshes to show new state.
      Check: clicking each button changes data AND updates the view — verified by a
      real click, not "code looks right".
- [x] A2. Nav routing + sub-pages (SEPARATE, larger job): install react-router, give
      each nav item a real destination page. Do this only after A1.
      Check: each nav item routes to its page; role guards hold.

### B. Agents visible in the terminal (requested)
- [x] B1. Every agent already uses @traced_node. Add a single runnable entry point
      (e.g. `python -m agents.run_case <case_id>` or a small `watch` script) that
      runs the supervisor and streams the live trace to the terminal: each spoke's
      start, inputs, LLM call (model + latency + tokens), DB writes, output, total
      time, indented under the hub so the hub-and-spoke handoffs are visible live.
      Check: running one case prints the full hub→spoke→hub trace in order, and the
      resulting rows appear in Supabase.
- [x] B2. (Optional) surface a compact "agent activity" view in the HR dashboard that
      reads the trace/log rows, so non-terminal users can see agents ran.
      Check: HR dashboard shows the latest agent run for a case.

### C. Email delivery (Phase 7 → BUILT)
- [x] C1. Set EMAIL_TEST_RECIPIENT (and confirm EMAIL_SENDER/EMAIL_APP_PASSWORD are
      Edge Function secrets, not just local .env). Trigger one notification and
      confirm it actually lands in an inbox.
      Check: a real email arrives, not just a dev-log line.

### D. Drift cleanup — plan must match reality
- [x] D1. Fix blueprint self-inconsistency (this file is now the single source).
- [x] D2. Add the missing migration for it_task_view (exists in DB, no migration file)
      so supabase/migrations/ is a complete record of the live schema.
      Check: a fresh DB rebuilt from migrations matches the live schema.

### E. Phase 9 — real end-to-end review (do LAST, then tick Phase 9)
- [ ] E1. In a REAL browser: log in as employee, HR, manager, IT. For each, confirm
      the dashboard loads correct live data, action buttons work, and no console
      errors. Run one full exit case start→finish and watch the terminal trace.
      Check: all four roles work in-browser; one case completes end-to-end; email
      delivered; calendar event created. Only then tick Phase 9.

### F. Resignation gate (new scope, added after E1 review)
- [ ] F1. Employee login checks for a resignation (exit_cases row for their
      employee_id). Not submitted -> redirect to /employee/resignation, dashboard
      unreachable. Submitted -> normal dashboard. Resignation page: last working
      day (date picker) + optional reason, POSTs to the submit-resignation Edge
      Function (service-role insert, identity derived server-side from the JWT —
      never trusted from the request body). Does NOT trigger agents.
      Check: fresh employee -> resignation page; after submit -> dashboard;
      already-resigned employee -> dashboard directly. Verified via Playwright
      (headless real browser): all three pass, zero console errors.

### G. Exit pipeline trigger on resignation (new scope, added after F1)
- [ ] G1. On successful submit-resignation, frontend calls a new local agent
      service (agents/service.py, POST /activate-exit) which runs
      hr_agent.generate_checklist (idempotent) and sets exit_cases.status ->
      in_progress, then notifications.send_resignation_notice emails the
      manager. Task due_dates derive from last_working_day (hr stage: -3
      days, manager stage: -1 day) via existing hr_agent logic. Deliberately
      does NOT run the full supervisor_graph (that would auto-approve the
      manager gate and complete IT/finance/risk unconditionally).
      Check: submitting a resignation creates real exit_tasks with dates
      derived from last_working_day, sends the manager email, and the
      employee dashboard shows the generated checklist + timeline. Verified
      via Playwright (fresh employee, real pipeline run) + direct DB read +
      agent service trace log: all pass, zero console errors.

### H. Resignation gate seed-data consistency (new scope, added after G1)
- [ ] H1. The gate in F1 is generic (checks for an exit_cases row by employee_id,
      never hardcoded to an ID range) -- EmployeeLayout.jsx's
      `if (!data.exitCase) return <Navigate to="/employee/resignation" replace />`.
      The ID split (Emp001-010 "resigned", Emp011-100 fresh) is a property of the
      SEED DATA, not the gate logic, so seed.js and the live DB must agree:
      Emp001-010 always get an exit_cases row (scripts/seed.js now seeds the first
      10, not 5); Emp011-100 never do at seed time. Any ad hoc case created for an
      Emp011+ account during testing must be cleared afterward so the invariant
      holds for the next reviewer/demo.
      Check: `select employee_id, exists(...)` across Emp001-100 shows exactly
      1-10 with a case, 11-100 without. Verified via direct SQL against the live
      project: 10/10 low, 0/90 high. Confirmed via real browser: Emp001 (has a
      case) lands on the dashboard directly; Emp011 (no case) is redirected to
      /employee/resignation.

---

### I. Manager gate: approved branch (new scope, added after H1)
- [ ] I1. G1 stage-gates the automatic path on purpose, but only the REJECTED
      branch of the manager gate had a trigger (`/reject-manager-task`). The
      approved branch had none, so a browser-created case stopped after the HR
      checklist: nothing outside supervisor_graph ever called
      it_agent.generate_plan, so stage='it' tasks were never created, compliance
      sat on "no IT task found" forever, and the relieving gate
      (RELIEVING_LETTER_STAGES includes 'it') could never open. Unlike
      compliance and finance, the IT stage had no per-stage re-entry endpoint.
      Fix: agents/service.py `/manager-approve` (the mirror of
      `/reject-manager-task`, same shape as `/finance-settle-check`), called by
      ManagerPages.jsx's useApprove after its own RLS-scoped
      `update({status:'done'})`. It never performs the approval and never
      bypasses the human gate -- it re-reads the case with the service key and
      advances ONLY when every non-escalation manager task is done and no
      escalation is open, then writes the two things the browser path could
      not: agent_runs(stage='manager', detail='approved') (the only source
      compliance_agent._manager_item reads) and the stage='it' rows via the
      already-idempotent it_deprovisioning_agent.generate, before the same
      single-case compliance re-check every other endpoint here ends with.
      Still NOT the full supervisor_graph.
      Check: scripts/verify_manager_gate.cjs -- two disposable cases created by
      real browser resignation, then purged. Happy path, no `run_case`
      anywhere: resignation -> hr:3/manager:4 and ZERO it tasks -> employee
      clears HR tasks -> manager approves 4/4 KT -> 5 IT tasks appear, gate
      recorded once -> IT approves 5/5 -> finance settles -> compliance no
      longer blocked on IT -> HR's "Issue relieving letter" offered for the
      case. Regression: rejection still escalates, and `/manager-approve`
      refuses to advance a case with an open escalation (no IT tasks created).
      All pass, zero console errors.

---

## Phase 10 — Finance clearance role (built after Phase 8/9, on top of the working system)

Adds `finance` as a real fifth role, not a mock:
- `profiles.role` gains `'finance'`; demo account Anfia (anfiacj@gmail.com) seeded with it.
- `/finance` dashboard (`FinanceLayout.jsx`/`FinancePages.jsx`, mirrors ManagerLayout's
  two-step fetch): a work queue of exit cases where hr/manager/it are done but dues
  aren't settled, with a "Mark dues settled" action — same design tokens as the other
  four dashboards.
- `exit_cases.finance_cleared` (bool, default false) + `dues_note` (text), via
  `0013_finance_role.sql`; `finance_agent.py` now gates on hr/manager/it done AND
  `finance_cleared = true`, blocking with reason "dues/settlement not confirmed"
  otherwise. Completion email still fires on the pending→done transition.
- RLS: finance reads case basics only through `finance_case_view` (never the base
  `exit_cases` table), so risk_score/risk_level/rehire_eligible/interview
  sentiment stay HR-only — same rule as every other non-HR role.
- Write path is the `public.finance_mark_dues_settled` RPC
  (`0014_finance_dues_rpc.sql`), not a base-table UPDATE policy: `exit_cases` has no
  SELECT policy for finance by design (a SELECT policy would have to expose the
  HR-only columns), and Postgres can't apply an UPDATE's `WHERE` clause to a row with
  no SELECT-policy visibility — a bare RLS UPDATE policy on `exit_cases` silently
  matches zero rows. The RPC is `SECURITY DEFINER`, checks the caller's role itself,
  and is forward-only (always sets `finance_cleared = true`).
- Verified in a real browser (Playwright): Anfia logs in → lands on `/finance` → sees
  the queue → clicks "Mark dues settled" → write lands in Supabase → `finance_agent.py`
  clears the case and fires the completion email → Anfia's risk-field read against the
  base `exit_cases` table returns zero rows (denied).

---

## Phase 11 — End-to-end automation capstone (agent #24, built on top of the working pipeline)

`agents/e2e_automation.py` — REUSE-only capstone, composes the existing hub + agents into
one autonomous start→finish run. No new agent logic, no new LLM calls, no new
escalation/notification code:
- `service.activate_case(case_id)` — real initiation (checklist + resignation notice +
  `status → in_progress`), the same entry the frontend resignation flow uses.
- `supervisor.run_case(...)` — hr→manager gate→it→compliance→finance→assess, unchanged.
  Its existing `_route_after_manager`/`_escalate` branch (not new code) handles a rejected
  manager gate by re-routing to escalation instead of continuing/crashing.
- SLA breach check scoped to just this one case (fetches only its own pending
  `exit_tasks` + its case/profile rows, calls `sla_escalation.find_breaches` — a pure
  function — then reuses `sla_escalation`'s own `_escalate` node for compose/send/DB-write),
  rather than `sla_escalation.run()`'s global scan across every case.
- Finalize step reads back the persisted compliance/finance `exit_tasks` rows those agents
  actually wrote: `exit_cases.status → 'completed'` only when both read back `done`;
  otherwise a clear `{"status": "blocked", "reason": ...}` naming the blocking task(s) —
  never a crash, never a silent success.

Verified live (two real runs, full trace, real DB writes, real LLM calls):
- `python -m agents.e2e_automation <case_id>` (happy path): initiate (resignation-notice
  email fired) → hr→manager approved→it→compliance→finance→assess → SLA check (0 breaches)
  → finalize. Ended `{"status": "blocked", "reason": "Final clearance blocked: NDA:
  pending; ..."}` — compliance/finance genuinely hadn't cleared for that case, a valid
  terminal state per the task's own spec ("completed, or clearly-blocked with reason").
- `python -m agents.e2e_automation <case_id> --reject` (simulated rejection, different
  case): hr ran, manager gate recorded "rejected", the existing escalate branch fired
  (`exit_tasks` + `agent_runs` inserted, graph ended via `END`, IT/compliance/finance/assess
  never reached) → finalize short-circuited to `{"status": "blocked", "reason": "manager
  rejected KT plan -- escalated to HR"}`. Re-route/escalation, not a crash.
- Regression check: `python -m agents.run_case <case_id>` run directly afterward
  (bypassing the capstone) — full hub→spoke trace, no change in behavior.

---

## Order to do it in
1. A1 (wire action buttons) — makes the app feel alive.
2. B1 (terminal trace entry point) — you asked for this; agents visible live.
3. C1 (email delivery) — small, closes Phase 7.
4. D1/D2 (drift cleanup) — keeps plan == reality.
5. A2 (nav routing + pages) — larger frontend build.
6. E1 (browser end-to-end review) — then tick Phase 9.
