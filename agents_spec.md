# agents_spec.md — Exit AI: all 24 agents

Architecture: **LangGraph** · **hub-and-spoke** (supervisor hub + agent spokes) ·
**Supabase** · **Portkey gateway**. Spokes coordinate ONLY through the hub.

Build order: **phases of 2–3 agents each**, foundation first. Build a phase, verify it
in the terminal trace, then move on. Reuse existing verified code; wrap, don't duplicate.

Status legend:
- **DONE** — built & verified (live DB / trace evidence)
- **REUSE** — logic exists in another module; this is a named wrapper
- **NEW** — to build
- **NEW-min** — build real at demo scale; full dependency (OCR / external APIs) is a
  documented stand-in

The authoritative full descriptions live in `docs/agent_requirements.md`. Every agent
is its own module in `/agents`, `@traced_node`-wrapped so it shows in the terminal.

---

## PHASE 0 — foundation (already built, verify only)
The hub + core clearance already run end-to-end. Confirm before building on top.

| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 20 | Exit Process Orchestrator (Supervisor/hub) | hub/supervisor.py | LangGraph routes hr→manager gate→it→finance→assess; exception/escalation branch | DONE |
| 2 | HR Agent | spokes/hr_agent.py | LLM checklist + KT review; books calendar; idempotent. `manager_tasks` are knowledge-transfer/handover items ONLY — `IT_OWNED_TITLE_RE` drops IT deprovisioning titles the LLM mis-files there (they would otherwise sit on the manager's KT queue as un-doable work and hold the manager→IT gate shut); the IT agent generates those properly at the gate | DONE |
| 3 | IT Agent | spokes/it_agent.py | LLM deprovisioning tasks; human-approved. Triggered by hub/supervisor.py's `it` stage node on a `run_case`, and on the browser path by service.py's `/manager-approve` once the manager has approved every KT task (idempotent — skips when stage='it' rows exist) | DONE |
| 4 | Finance Agent | spokes/finance_agent.py | deterministic clearance gate: clears only when hr/manager/it are all done AND `exit_cases.finance_cleared` is true (the real dues flag, written by the Finance dashboard's "Mark dues settled" button); otherwise blocked with reason "dues/settlement not confirmed". Completion email fires on the pending→done transition | DONE |
| 1 | Manager | (manager-gate node) | human role — approval gate, NOT an LLM agent. Both branches are reachable from the browser: Reject → service.py `/reject-manager-task` (escalation row), Approve → `/manager-approve` (records the gate in agent_runs and advances to IT). `/manager-approve` has two UI triggers, both idempotent and both server-re-checked: the per-task Review button, and the Manager dashboard's single per-employee "Sign clearance" action (one sign-off per employee, active only once every one of that employee's KT tasks is approved) | DONE |

**Verify:** run one case via run_case.py; trace shows hub→hr→manager gate→it→finance.

**Finance role (dashboard, not a numbered agent):** a 5th dashboard/role (`profiles.role
= 'finance'`) at `/finance` — a work queue (`FinanceLayout.jsx`/`FinancePages.jsx`,
mirrors the Manager layout's two-step fetch) listing exit cases where hr/manager/it are
done but `finance_cleared` is false. Same HR-only column restriction as every other
non-HR role: finance reads case basics through `finance_case_view` (0013_finance_role.sql),
never the base `exit_cases` table, so risk_score/risk_level/rehire_eligible/interview
sentiment stay HR-only. Write path is `public.finance_mark_dues_settled(case_id, dues_note)`
(0014_finance_dues_rpc.sql), a `SECURITY DEFINER` RPC rather than a base-table UPDATE
policy — `exit_cases` deliberately has no SELECT policy for finance (to keep those
HR-only columns hidden), and Postgres cannot apply an UPDATE's `WHERE` clause to a row
with no SELECT policy granting it visibility, so a bare RLS UPDATE policy silently
no-ops. The RPC bypasses RLS, checks the caller's role itself, and is forward-only
(always sets `finance_cleared = true`).

---

## PHASE 1 — clearance content agents (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 5 | Exit Checklist Generator | checklist_generator.py | role/dept → personalized checklist (assets, access, KT topics). REUSE hr_agent checklist logic as a named agent | REUSE |
| 18 | Automated IT Deprovisioning | it_deprovisioning.py | plan of accounts/access/data to archive, human-in-the-loop. REUSE it_agent logic | REUSE |

**Verify:** run a case; checklist_generator writes role-appropriate exit_tasks;
it_deprovisioning writes it-stage tasks, all pending until approved.

---

## PHASE 2 — communication agents (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 6 | Email Drafting | email_drafting.py | stage-specific emails (KT reminder, overdue, completion) via templates. REUSE core/notifications.py compose | REUSE |
| 7 | FAQ Chatbot (RAG) | supabase/functions/ask | employee Q&A over exit_docs, cites sources, refuses out-of-scope | DONE (Edge Fn) |

**Verify:** trigger each email type (real send to EMAIL_TEST_RECIPIENT — confirm inbox,
not dev-log); ask the chatbot a real question → cited answer, and an out-of-scope one → refusal.

---

## PHASE 3 — interview intelligence (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 8 | Exit Interview Summarizer | spokes/exit_intel_agent.py (per-case) | LLM → summary, sentiment, themes, recommendations | DONE |
| 10 | KT Document Reviewer | kt_reviewer.py | LLM reviews KT doc for completeness, flags gaps by role. REUSE hr_agent kt-review | REUSE |

**Verify:** submit an interview → exit_interviews row gets summary+sentiment; give a KT
doc with a missing topic → gap task + kt_reviews row.

---

## PHASE 4 — risk & compliance (2–3)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 12 | Exit Risk Assessment | spokes/risk_agent.py | deterministic weighted risk score + mitigations | DONE |
| 13 | Compliance Verification | spokes/compliance_agent.py | verify asset return, NDA, access revoked before final clearance. NEW (split from risk/finance) | DONE |
| 21 | Intelligent Rehire Assessment | spokes/rehire_agent.py | eligibility from performance + sentiment + manager feedback. REUSE risk rehire field, own module | DONE |

**Verify:** risk fields show on HR dashboard; compliance blocks final clearance when NDA
missing (with reason); rehire flag set with rationale.

---

## PHASE 5 — analytics family (2–3)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 14 | Dashboard Insights | analytics/analytics_agent.py | trends/bottlenecks/dept patterns → narrative (arithmetic in Python, LLM writes narrative) | DONE |
| 17 | Exit Workflow Optimizer | analytics/workflow_optimizer.py | which stages/depts delay → proposed reconfigurations. REUSE analytics aggregation | DONE |
| 23 | Predictive Attrition | analytics/attrition_agent.py | signals → at-risk employees → retention suggestions, scheduled | DONE |

**Verify:** each writes an analytics_insights/report row; counts in the narrative match a
manual SQL count.

---

## PHASE 6 — escalation & scheduled monitors (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 9 | SLA Escalation | analytics/sla_escalation.py | scans clearances >5 days overdue → escalation message (who's blocking, how long, impact). REUSE notifications overdue scan, own agent | DONE |
| 22 | Policy Compliance Auditor | analytics/policy_auditor.py | audit of active cases vs policy (SLA breaches, missing approvals, skipped steps) → report. ON-DEMAND, not periodic: `python -m agents.analytics.policy_auditor` prints a formatted report and writes `analytics_insights` with `agent_type='policy_compliance_auditor'`; HR → Policy audit shows the latest row. No scheduler exists (follow-up) | DONE |

**Verify:** create an overdue case → SLA agent composes a real escalation naming the
blocker; run auditor → report row listing any breaches across active cases.

---

## PHASE 7 — trend & document intelligence (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 19 | Exit Interview Trend Analyst | spokes/exit_intel_agent.py (longitudinal) | longitudinal analysis, rising-theme alerts per dept | DONE |
| 16 | Document Collection | spokes/doc_collection.py | required docs, track submitted/missing, reminders, validate uploads via REAL OCR (pytesseract + Tesseract binary) | DONE |

**Verify:** longitudinal run inserts a trend_alerts row (re-run live: inserted "management" +
"management support", 2 new rows); doc agent lists required vs submitted/missing for a
real case (Aiden Sharma/Engineering: required 3, submitted [NDA], missing 2), sends a real
reminder email for the missing docs, and runs real Tesseract OCR against a synthesized NDA
test image (agents/test_docs/nda_test.png) -- OCR text shown in the trace, content validated
("non-disclosure" + "signature" both matched), case_documents row flipped to validated.

---

## PHASE 8 — routing & multi-system (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 11 | Smart Routing | spokes/smart_routing.py | picks the real approver profile for a stage (hr/manager/it) by department match + out_of_office (0012_profiles_out_of_office.sql), routing to a real delegate profile when the primary is OOO. Wired as a tool call from hub/supervisor.py's hr/manager/it stage nodes | DONE |
| 15 | Multi-System Clearance | spokes/multi_system_clearance.py | consolidates clearance across IT asset mgmt/HRMS/finance. DEMO STAND-IN: no external systems exist, so it queries OUR exit_tasks (by stage) + case_documents live and consolidates for real -- labeled as such in the module docstring. Wired as a tool call from hub/supervisor.py's compliance stage node | DONE-demo-scale |

**Verify:** marked siva@company.com (primary hr approver) out_of_office=true, ran
`smart_routing` live for a real Engineering case → routed to the real delegate profile
"Divya (HR Delegate)" (scripts/seed/seed_delegates.js), reason "primary (Siva) is
out_of_office -> routed to delegate"; reverted the flag, re-ran → routed back to Siva
("primary approver available"). Ran `multi_system_clearance` live for the same case →
real consolidated object across the three stand-in sources (it=cleared, hrms=pending
["Complete exit interview"], finance=pending ["Clear final settlement dues"],
overall=pending). Full `python -m agents.hub.supervisor <case_id>` pipeline re-run
afterward, trace shows both tools firing inside the hr/manager/it/compliance stage
nodes, run completed hr→manager→it→compliance→finance→assess with no errors.

---

## PHASE 9 — capstone (1)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 24 | End-to-End Exit Automation | hub/e2e_automation.py | fully autonomous: initiates exit (service.activate_case), coordinates all stages via supervisor.run_case (hr→manager gate→it→compliance→finance→assess), checks this case's own tasks for SLA breaches (reuses sla_escalation.find_breaches + its _escalate node, scoped to one case not a global scan), then reads back the persisted compliance/finance task rows to decide exit_cases.status. REUSE supervisor + all above | DONE |

**Verify:** `python -m agents.hub.e2e_automation <case_id>` ran a full exit start→finish live
(case 13eaa5fe...: initiate [resignation-notice email fired] → hr→manager gate approved→it→
compliance→finance→assess, all real DB writes/LLM calls → SLA check 0 breaches → finalize),
ending in a clear `{"status": "blocked", "reason": "Final clearance blocked: NDA: pending; ..."}`
(compliance/finance hadn't actually cleared for that case -- a valid, non-crashing terminal
state, not a silent failure). `python -m agents.hub.e2e_automation <case_id> --reject` on a second
case (e075f375...) exercised the escalation branch live: hr ran, manager gate recorded
"rejected", the existing `_route_after_manager`/`_escalate` branch fired (exit_tasks +
agent_runs rows inserted, graph ended via END, IT/compliance/finance/assess never reached),
finalize short-circuited to `{"status": "blocked", "reason": "manager rejected KT plan --
escalated to HR"}` -- re-route/escalation instead of a crash. Re-ran `python -m
agents.run_case <case_id>` directly afterward (bypassing the capstone): full hub→spoke trace,
no regression -- existing per-case pipeline still works unchanged.

---

## Build rule for every phase
1. Reuse existing verified logic via shared helpers — wrap, don't duplicate.
2. Each agent is its own module, @traced_node-wrapped (shows in terminal).
3. Build the phase → run a case / trigger the agent → confirm real work in the trace →
   confirm the existing pipeline still completes → then next phase.
4. Never mark an agent DONE without trace/DB evidence. NEW-min agents stay labeled
   until their real dependency (OCR, external APIs) is wired.

## Honest status summary
- DONE now (19): 20, 2, 3, 4, 1(gate), 8, 12, 13, 14, 17, 19, 21, 23, 7(edge fn), 9, 22, 16, 11, 24 — core works.
- REUSE (named wrappers over existing code): 5, 18, 6, 10, 9.
- NEW to build: none remaining.
- DONE-demo-scale (real at demo scale, dependency is stand-in): 15 (multi-system — stand-in is our own Supabase tables in place of IT asset mgmt/HRMS/finance systems).
- Capstone (#24) composes the above rather than adding new agent logic — no new LLM calls, no new escalation/notification code; see PHASE 9 verify evidence.
