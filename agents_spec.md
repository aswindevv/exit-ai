# agents_spec.md — Exit AI agent specifications

Stack: **LangGraph** · **hub-and-spoke** (supervisor hub + agent spokes) ·
**Supabase** · **Portkey gateway**. Spokes coordinate ONLY through the hub.

Each agent below has: what it does, trigger, reads, writes, the 24-list capabilities
it covers, and a **verify** check (how you PROVE it works — a real run, not "code looks
right"). Every agent is `@traced_node`-wrapped so its run is visible in the terminal.

Status legend: [x] built & verified · [~] built, not fully verified · [ ] not built

---

## 0. Supervisor (the HUB)  [~]
- Does: receives an exit case, routes it to each spoke in order, waits for all
  clearance gates, handles exceptions (rejection, re-route, escalation), finalizes.
- Trigger: `run_case(case_id)` — a new/updated exit case.
- Reads: exit_cases, exit_tasks. Writes: case stage/status; orchestrates spokes.
- Covers: #20 orchestrator, #24 end-to-end capstone.
- Verify: run one case; the terminal trace shows the hub calling each spoke in order
  and returning; case reaches a final state. Simulate a rejection → trace shows the
  re-route/escalation branch, not a crash.

---

## CLEARANCE SPOKES

## 1. HR agent  [~]
- Does: generates the exit checklist from role/department; reviews the KT document for
  completeness and flags gaps; tracks required documents.
- Trigger: supervisor, on a new case; also agents.service.activate_case (local
  HTTP bridge, POST /activate-exit) on employee resignation submission —
  generates the checklist directly, without running the full supervisor.
- Reads: exit_cases (role, dept). Writes: exit_tasks (checklist), kt_reviews (gaps).
- Covers: #2, #5 checklist generator, #10 KT reviewer, #16 document collection.
- Verify: run a case → exit_tasks gets a role-appropriate checklist (not seed data);
  give it a KT doc with a missing topic → kt_reviews row lists the gap.

## 2. IT agent  [~]
- Does: generates the deprovisioning plan (accounts to disable, access to revoke,
  assets to collect) as IT-stage tasks; execution is human-approved.
- Trigger: supervisor, IT stage.
- Reads: exit_cases. Writes: exit_tasks (stage='it').
- Covers: #3, #18 automated IT deprovisioning.
- Verify: run a case → IT-stage tasks appear, all 'pending' until approved (no
  auto-execute).

## 3. Finance agent  [~]
- Does: verifies financial clearance (dues, reimbursements); marks the finance gate.
- Trigger: supervisor, finance stage.
- Reads: exit_cases, exit_tasks. Writes: finance clearance status.
- Covers: #4.
- Verify: run a case → finance stage gets a clear pass/hold status with a reason.

---

## COMMUNICATION SPOKES

## 4. Notification agent  [~ — sends dev-logged only until email delivery fixed]
- Does: drafts and sends stage-based messages (KT reminder, overdue warning,
  completion) and SLA escalation messages with context (who's blocking, how long).
- Trigger: stage events; overdue clearance (>5 days) for escalation mode;
  resignation notice to the manager on submission (agents.service).
- Reads: exit_tasks, exit_cases. Writes: notification log; sends email via Gmail SMTP.
- Covers: #6 email drafting, #9 SLA escalation.
- Verify: trigger a notification → a REAL email arrives (set EMAIL_TEST_RECIPIENT;
  confirm secrets are Edge Function secrets, not just local .env). Overdue case →
  escalation message names the blocker and duration.

## 5. FAQ chatbot (RAG)  [x]
- Does: answers employee exit questions from process docs; cites sources; refuses when
  the answer isn't in the docs; offers "forward to HR" on refusal.
- Trigger: employee asks in the dashboard "Ask" box.
- Reads: exit_docs (pgvector). Writes: nothing (read-only retrieval).
- Covers: #7.
- Verify: ask "when do I get my final settlement?" → cited answer. Ask an out-of-scope
  question → refusal, no source. (Already passing acceptance checks.)

---

## INTELLIGENCE & COMPLIANCE SPOKES

## 6. Exit-Interview agent  [~]
- Does: per-case → structured summary, sentiment, key themes, recommendations;
  longitudinal mode → detects rising themes per department and raises alerts.
- Trigger: per-case on interview submission; longitudinal on a schedule.
- Reads: exit_interviews. Writes: exit_interviews (analysis), trend_alerts.
- Covers: #8 summarizer, #19 trend analyst.
- Verify: submit an interview → summary+sentiment populate that row. Run longitudinal
  over seeded interviews → trend_alerts gets a rising-theme row.

## 7. Compliance & Risk agent  [~]
- Does: scores exit risk (tenure, role criticality, dependencies, sentiment) →
  risk_score + level + mitigations; verifies compliance before final clearance
  (assets returned, NDA, access revoked); periodic policy audit of active cases.
- Trigger: per-case for risk; final-clearance gate for compliance; schedule for audit.
- Reads: exit_cases, exit_tasks, exit_interviews. Writes: risk_level, risk_score,
  rehire_eligible on exit_cases; compliance status; audit report rows.
- Covers: #12 risk, #13 compliance verification, #21 rehire (partly), #22 policy auditor.
- Verify: run a case → risk fields populate and show in the HR dashboard "Risk" column.
  Run compliance on a case missing NDA → it blocks final clearance with the reason.

## 8. Analytics agent  [~]
- Does: aggregates historical cases/tasks (in SQL/Python, NOT the LLM) → the LLM writes
  a narrative of bottlenecks, department patterns, and attrition signals; proposes
  workflow improvements.
- Trigger: scheduled (e.g. weekly).
- Reads: exit_cases, exit_tasks history. Writes: analytics_insights.
- Covers: #14 dashboard insights, #17 workflow optimizer, #23 predictive attrition.
- Verify: run it → analytics_insights gets a narrative row; confirm the counts in the
  narrative match a manual SQL count (arithmetic done in code, not the LLM).

---

## TOOL-NODES (not standalone reasoning agents)
- Smart Routing (#11): picks the approver by availability/workload/OOO — a tool the
  supervisor calls. Verify: with an approver marked OOO, routing picks the delegate.
- Multi-System Clearance (#15): calls IT/HRMS/finance to consolidate status — a
  tool-node. Verify: it returns a consolidated status object across the sources.

## NOT AN AGENT
- Manager (#1): a human role in the manager dashboard (approves KT). Not code.

---

## Per-agent verification run (do this to answer "does every agent work?")
Run one full case with the terminal trace on, then check the box for each agent whose
spoke actually fired AND wrote its expected output:
- [ ] Supervisor routed to every spoke (visible in trace)
- [ ] HR wrote checklist + KT review
- [ ] IT wrote deprovisioning tasks (pending)
- [ ] Finance set clearance status
- [ ] Exit-Interview wrote summary + sentiment
- [ ] Compliance & Risk wrote risk fields (shown in HR dashboard)
- [ ] Analytics wrote an insights row (counts verified)
- [ ] Notification sent a REAL email (not dev-log)
- [ ] FAQ chatbot answers with source + refuses out-of-scope

Any agent that does NOT fire in a normal run (schedule/condition-triggered) must be
run/tested on its own — do not claim it works until its trace and output are seen.
