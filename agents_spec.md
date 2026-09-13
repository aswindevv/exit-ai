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
| 20 | Exit Process Orchestrator (Supervisor/hub) | supervisor.py | LangGraph routes hr→manager gate→it→finance→assess; exception/escalation branch | DONE |
| 2 | HR Agent | hr_agent.py | LLM checklist + KT review; books calendar; idempotent | DONE |
| 3 | IT Agent | it_agent.py | LLM deprovisioning tasks; human-approved | DONE |
| 4 | Finance Agent | finance_agent.py | deterministic clearance gate + completion email | DONE |
| 1 | Manager | (manager-gate node) | human role — approval gate, NOT an LLM agent | DONE |

**Verify:** run one case via run_case.py; trace shows hub→hr→manager gate→it→finance.

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
| 6 | Email Drafting | email_drafting.py | stage-specific emails (KT reminder, overdue, completion) via templates. REUSE notifications.py compose | REUSE |
| 7 | FAQ Chatbot (RAG) | supabase/functions/ask | employee Q&A over exit_docs, cites sources, refuses out-of-scope | DONE (Edge Fn) |

**Verify:** trigger each email type (real send to EMAIL_TEST_RECIPIENT — confirm inbox,
not dev-log); ask the chatbot a real question → cited answer, and an out-of-scope one → refusal.

---

## PHASE 3 — interview intelligence (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 8 | Exit Interview Summarizer | exit_intel_agent.py (per-case) | LLM → summary, sentiment, themes, recommendations | DONE |
| 10 | KT Document Reviewer | kt_reviewer.py | LLM reviews KT doc for completeness, flags gaps by role. REUSE hr_agent kt-review | REUSE |

**Verify:** submit an interview → exit_interviews row gets summary+sentiment; give a KT
doc with a missing topic → gap task + kt_reviews row.

---

## PHASE 4 — risk & compliance (2–3)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 12 | Exit Risk Assessment | risk_agent.py | deterministic weighted risk score + mitigations | DONE |
| 13 | Compliance Verification | compliance_agent.py | verify asset return, NDA, access revoked before final clearance. NEW (split from risk/finance) | DONE |
| 21 | Intelligent Rehire Assessment | rehire_agent.py | eligibility from performance + sentiment + manager feedback. REUSE risk rehire field, own module | DONE |

**Verify:** risk fields show on HR dashboard; compliance blocks final clearance when NDA
missing (with reason); rehire flag set with rationale.

---

## PHASE 5 — analytics family (2–3)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 14 | Dashboard Insights | analytics_agent.py | trends/bottlenecks/dept patterns → narrative (arithmetic in Python, LLM writes narrative) | DONE |
| 17 | Exit Workflow Optimizer | workflow_optimizer.py | which stages/depts delay → proposed reconfigurations. REUSE analytics aggregation | DONE |
| 23 | Predictive Attrition | attrition_agent.py | signals → at-risk employees → retention suggestions, scheduled | DONE |

**Verify:** each writes an analytics_insights/report row; counts in the narrative match a
manual SQL count.

---

## PHASE 6 — escalation & scheduled monitors (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 9 | SLA Escalation | sla_escalation.py | scans clearances >5 days overdue → escalation message (who's blocking, how long, impact). REUSE notifications overdue scan, own agent | DONE |
| 22 | Policy Compliance Auditor | policy_auditor.py | periodic audit of active cases vs policy (SLA breaches, missing approvals, skipped steps) → report | DONE |

**Verify:** create an overdue case → SLA agent composes a real escalation naming the
blocker; run auditor → report row listing any breaches across active cases.

---

## PHASE 7 — trend & document intelligence (2)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 19 | Exit Interview Trend Analyst | exit_intel_agent.py (longitudinal) | longitudinal analysis, rising-theme alerts per dept | DONE |
| 16 | Document Collection | doc_collection.py | required docs, track submitted/missing, reminders, validate uploads via REAL OCR (pytesseract + Tesseract binary) | DONE |

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
| 11 | Smart Routing | smart_routing.py | picks the real approver profile for a stage (hr/manager/it) by department match + out_of_office (0012_profiles_out_of_office.sql), routing to a real delegate profile when the primary is OOO. Wired as a tool call from supervisor.py's hr/manager/it stage nodes | DONE |
| 15 | Multi-System Clearance | multi_system_clearance.py | consolidates clearance across IT asset mgmt/HRMS/finance. DEMO STAND-IN: no external systems exist, so it queries OUR exit_tasks (by stage) + case_documents live and consolidates for real -- labeled as such in the module docstring. Wired as a tool call from supervisor.py's compliance stage node | DONE-demo-scale |

**Verify:** marked siva@company.com (primary hr approver) out_of_office=true, ran
`smart_routing` live for a real Engineering case → routed to the real delegate profile
"Divya (HR Delegate)" (scripts/seed_delegates.js), reason "primary (Siva) is
out_of_office -> routed to delegate"; reverted the flag, re-ran → routed back to Siva
("primary approver available"). Ran `multi_system_clearance` live for the same case →
real consolidated object across the three stand-in sources (it=cleared, hrms=pending
["Complete exit interview"], finance=pending ["Clear final settlement dues"],
overall=pending). Full `python -m agents.supervisor <case_id>` pipeline re-run
afterward, trace shows both tools firing inside the hr/manager/it/compliance stage
nodes, run completed hr→manager→it→compliance→finance→assess with no errors.

---

## PHASE 9 — capstone (1)
| # | Agent | File | Does | Status |
|---|-------|------|------|--------|
| 24 | End-to-End Exit Automation | e2e_automation.py | fully autonomous: initiates exit, coordinates all stages, handles rejections/escalations/re-routing, communicates with stakeholders. REUSE supervisor + all above | REUSE |

**Verify:** one command runs a full exit start→finish, including a simulated rejection
that triggers re-route/escalation, with the terminal trace narrating every agent.

---

## Build rule for every phase
1. Reuse existing verified logic via shared helpers — wrap, don't duplicate.
2. Each agent is its own module, @traced_node-wrapped (shows in terminal).
3. Build the phase → run a case / trigger the agent → confirm real work in the trace →
   confirm the existing pipeline still completes → then next phase.
4. Never mark an agent DONE without trace/DB evidence. NEW-min agents stay labeled
   until their real dependency (OCR, external APIs) is wired.

## Honest status summary
- DONE now (18): 20, 2, 3, 4, 1(gate), 8, 12, 13, 14, 17, 19, 21, 23, 7(edge fn), 9, 22, 16, 11 — core works.
- REUSE (named wrappers over existing code): 5, 18, 6, 10, 9.
- NEW to build: none remaining.
- DONE-demo-scale (real at demo scale, dependency is stand-in): 15 (multi-system — stand-in is our own Supabase tables in place of IT asset mgmt/HRMS/finance systems).
