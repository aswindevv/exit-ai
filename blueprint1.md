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
- HR agent ← #2, #5 checklist, #10 KT review, #16 doc collection
- IT agent ← #3, #18 deprovisioning
- Finance agent ← #4
- Notification agent ← #6 email drafting, #9 SLA escalation
- FAQ chatbot ← #7 (built as RAG)
- Exit-Interview agent ← #8, #19 trend analyst (longitudinal mode)
- Risk agent ← #12, part of #21 rehire
- Compliance agent ← #13, #22 policy auditor (scheduled)
- Analytics agent ← #14, #17 optimizer, #23 attrition
- Supervisor ← #20 orchestrator, #24 end-to-end capstone
- Tool-nodes (not standalone agents): #11 smart routing, #15 multi-system clearance
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

## Order to do it in
1. A1 (wire action buttons) — makes the app feel alive.
2. B1 (terminal trace entry point) — you asked for this; agents visible live.
3. C1 (email delivery) — small, closes Phase 7.
4. D1/D2 (drift cleanup) — keeps plan == reality.
5. A2 (nav routing + pages) — larger frontend build.
6. E1 (browser end-to-end review) — then tick Phase 9.
