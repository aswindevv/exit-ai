# 24-Agent Employee Exit Management --- Phased Implementation Plan

## Objective

Audit, fix, verify, and productionize the existing 24-agent Employee
Exit Management platform **without rebuilding the application or
changing the approved UI/UX design**.

The implementation must use the real application flow, real database
state, real agent execution, Portkey/LLM integration where applicable,
RLS/security controls, human approval gates, auditability, idempotency,
and safe database migrations.

**Accuracy is more important than making the system appear complete.**

------------------------------------------------------------------------

# Global Rules --- Apply to Every Phase

## 1. Strict UI/UX Freeze

The existing UI/interface is approved.

**Do not change:**

-   Overall layout
-   Navigation
-   Sidebar
-   Header
-   Page structure
-   Cards
-   Tables
-   Buttons
-   Colors
-   Typography
-   Spacing
-   Icons
-   Theme
-   Design system
-   Existing visual hierarchy
-   Existing component styling

Only make the **minimum frontend logic changes technically required** to
correctly display backend state.

The main expected exception is the timeline behavior described in Phase
6.

Do not redesign anything.

------------------------------------------------------------------------

## 2. Inspect Before Modifying

Before changing code:

1.  Inspect the repository.
2.  Identify the existing implementation of the relevant agent.
3.  Trace the actual execution path.
4.  Identify database tables/functions/RPCs involved.
5.  Check existing tests.
6.  Check existing environment/configuration.
7.  Determine whether the feature is actually invoked in the live
    workflow.
8.  Only then modify code.

Do not assume that an agent is working because a file exists.

------------------------------------------------------------------------

## 3. No Fake Execution

Never claim an external system was integrated when it was not.

If an external API is unavailable:

-   Create a clearly named adapter/interface.
-   Use a realistic mock adapter only where required.
-   Simulate success, pending, failure, and timeout states.
-   Clearly label the implementation as mock/demo.
-   Keep the architecture ready for a real provider.

Do not insert fake production data merely to make the UI look complete.

------------------------------------------------------------------------

## 4. Real Database Evidence

Whenever an agent is claimed to be working, verify it using actual
database evidence where appropriate.

Evidence should include:

-   `agent_runs`
-   Relevant case/task tables
-   Agent-specific output tables
-   Status transitions
-   Timestamps
-   Error records
-   Audit records
-   Human approval records

------------------------------------------------------------------------

## 5. Human Gates Must Remain Human

The following approvals are intentionally human-controlled:

-   Manager approval/sign-off
-   IT approval
-   Finance settlement approval
-   IT deprovisioning approval where required

Do not bypass human gates merely to make the end-to-end workflow appear
autonomous.

------------------------------------------------------------------------

## 6. Security and RLS

Preserve existing security boundaries.

Current verification indicates:

-   `manager_case_view`, `it_task_view`, and `finance_case_view` expose
    role-safe columns.
-   `exit_cases` has an HR-only select policy.
-   RLS exists at the PostgreSQL/view level.

Do not weaken or bypass these controls.

Every new table, view, RPC, or query must be reviewed for role
isolation.

------------------------------------------------------------------------

## 7. Idempotency

Agent executions must be safe to retry.

Avoid:

-   Duplicate emails
-   Duplicate tasks
-   Duplicate documents
-   Duplicate deprovisioning actions
-   Duplicate analytics rows where not intended
-   Duplicate approval transitions

Use appropriate run IDs, unique constraints, status checks, or
idempotency keys.

------------------------------------------------------------------------

## 8. Error Handling

Every production agent should have:

-   Input validation
-   Timeout handling
-   Retry handling where appropriate
-   Failure status
-   Error logging
-   Auditability
-   Safe recovery
-   No silent failures

------------------------------------------------------------------------

## 9. Git Checkpoint Rule

Before starting each phase:

``` bash
git status
git add .
git commit -m "Checkpoint before Phase N"
git push
```

After successfully completing each phase:

``` bash
git status
git add .
git commit -m "Complete Phase N"
git push
```

Never begin a major phase with uncommitted unknown changes.

------------------------------------------------------------------------

# Current Known Baseline

The previous audit identified the following state.

  ---------------------------------------------------------------------------------
  \#                Agent             Current Status     Main Finding
  ----------------- ----------------- ------------------ --------------------------
  1                 Manager Agent     MANUAL-BY-DESIGN   Manager Review/Sign
                                                         workflow works through
                                                         human action

  2                 HR Agent          FULL               HR stage is present in
                                                         supervisor workflow

  3                 IT Agent          MANUAL-BY-DESIGN   IT pipeline works with
                                                         human approval

  4                 Finance Agent     MANUAL-BY-DESIGN   Finance pipeline works
                                                         with human settlement
                                                         approval

  5                 Exit Checklist    FULL               Personalized checklist
                    Generator                            generation works

  6                 Email Drafting    NOT WORKING        Live workflow bypasses the
                    Agent                                email drafting agent

  7                 FAQ Chatbot       PARTIAL/FULL       Chatbot works; RAG
                                                         implementation must be
                                                         verified

  8                 Exit Interview    FULL               Structured
                    Summarizer                           summary/sentiment/themes
                                                         observed

  9                 SLA Escalation    FULL               Overdue task triggers
                                                         escalation agent

  10                KT Document       FULL               Real LLM review/gap
                    Reviewer                             analysis observed

  11                Smart Routing     FULL               OOO/delegate routing
                                                         branch works

  12                Exit Risk         PARTIAL            Risk score exists; UI
                    Assessment                           currently rounds `0.826`
                                                         to `1`

  13                Compliance        PARTIAL            Needs item-level
                    Verification                         traceability

  14                Dashboard         PARTIAL            Shares analytics output
                    Insights                             with other agents

  15                Multi-System      PARTIAL            Internal task states are
                    Clearance                            used instead of real
                                                         external systems

  16                Document          PARTIAL            OCR works in synthetic
                    Collection                           test; needs real
                                                         upload-driven flow

  17                Workflow          PARTIAL            Shares analytics output
                    Optimizer                            with other agents

  18                IT Deprovisioning PARTIAL            Plan/approval exists;
                                                         actual execution layer
                                                         needs verification

  19                Exit Interview    PARTIAL/FULL       Trend output exists;
                    Trend Analyst                        should remain
                                                         independently attributable

  20                Exit Process      FULL/PARTIAL       Supervisor workflow works;
                    Orchestrator                         broader exception testing
                                                         required

  21                Intelligent       FULL/PARTIAL       Agent executes; required
                    Rehire Assessment                    inputs/calculation must be
                                                         verified

  22                Policy Compliance PARTIAL            Uses shared analytics
                    Auditor                              output; needs own
                                                         identifiable output

  23                Predictive        PARTIAL            Must be genuine
                    Attrition                            predictive/risk logic, not
                                                         generic analytics

  24                End-to-End Exit   FULL/PARTIAL       Orchestration works with
                    Automation                           human gates; needs
                                                         complete
                                                         exception/retry/reroute
                                                         verification
  ---------------------------------------------------------------------------------

------------------------------------------------------------------------

# PHASE 1 --- Baseline Audit

## Scope

**No functional code changes.**

The purpose is to establish the exact current state before
implementation.

## Tasks

1.  Inspect the complete repository.
2.  Map all 24 agents to:
    -   Source files
    -   Entry points
    -   Database tables
    -   RPCs/functions
    -   Agent-run records
    -   UI surfaces
    -   Supervisor/orchestrator paths
3.  Identify which agents are actually invoked.
4.  Identify dead/unreferenced agent implementations.
5.  Trace the complete employee exit workflow.
6.  Inspect Portkey/LLM configuration.
7.  Inspect SMTP/email configuration.
8.  Inspect RLS policies.
9.  Inspect migrations.
10. Inspect existing tests.
11. Establish a baseline test result.
12. Verify whether `CLAUDE.md` contains stale claims about email being
    dev-logged only.

## Required Deliverable

Produce a baseline report containing:

``` text
Agent #
Agent Name
Source File
Entry Point
Live Invocation
Database Evidence
UI Evidence
LLM Evidence
External Integration
Human Gate
Current Status
Known Limitation
```

Use only:

-   FULL
-   PARTIAL
-   MANUAL-BY-DESIGN
-   NOT WORKING

## Important

Do not fix anything in Phase 1.

The purpose is to create an evidence-based starting point.

------------------------------------------------------------------------

# PHASE 2 --- Core Agent Architecture (#1--#13)

## Scope

Work on agents:

-   #1 Manager Agent
-   #2 HR Agent
-   #3 IT Agent
-   #4 Finance Agent
-   #5 Exit Checklist Generator
-   #6 Email Drafting Agent
-   #7 FAQ Chatbot
-   #8 Exit Interview Summarizer
-   #9 SLA Escalation Agent
-   #10 KT Document Reviewer
-   #11 Smart Routing Agent
-   #12 Exit Risk Assessment
-   #13 Compliance Verification

------------------------------------------------------------------------

## #1 Manager Agent

Preserve the current human manager workflow.

Verify:

-   Manager can review tasks.
-   Manager can approve/sign.
-   Manager actions update the correct task.
-   Manager cannot access unauthorized cases.
-   Manager approval appears in the audit trail.
-   The action properly releases the next workflow stage.

Do not automate away the human approval.

------------------------------------------------------------------------

## #2 HR Agent

Verify:

-   HR stage is actually invoked.
-   Correct case/stage context is passed.
-   Agent run is recorded.
-   Errors are captured.
-   Idempotent execution is maintained.
-   Correct downstream stage is triggered.

------------------------------------------------------------------------

## #3 IT Agent

Verify:

-   IT stage executes.
-   IT tasks are generated correctly.
-   Human IT approval remains required.
-   Approval updates the correct task.
-   Workflow continues after approval.
-   RLS prevents unauthorized access.

------------------------------------------------------------------------

## #4 Finance Agent

Verify:

-   Finance clearance is generated.
-   Settlement calculation/state is correct.
-   Human settlement approval remains required.
-   `finance_mark_dues_settled` or equivalent RPC is safe.
-   Settlement is auditable.
-   Workflow continues after settlement.

------------------------------------------------------------------------

## #5 Exit Checklist Generator

Verify that checklist generation uses actual:

-   Employee role
-   Department
-   Assets
-   Access requirements
-   KT responsibilities

Checklist should be personalized and persisted.

No hardcoded generic checklist should be used as the production path.

------------------------------------------------------------------------

# #6 Email Drafting Agent --- CRITICAL FIX

This is the highest-priority fix in Phase 2.

## Current Problem

The live workflow currently bypasses `email_drafting_agent.py`.

Evidence shows the HR agent directly calls:

``` text
notifications.send_kt_reminder
```

while the Email Drafting Agent has no live invocations.

## Required Architecture

The live workflow must become:

``` text
Stage Agent
    ↓
Email Drafting Agent
    ↓
Structured Email
    ↓
Notification / SMTP
```

## Email Drafting Agent Requirements

It must support stage-specific messages such as:

-   KT reminder
-   KT overdue warning
-   Task completion notification
-   IT clearance notification
-   Finance notification
-   Escalation notification
-   Approval notification
-   Rejection notification
-   Other required workflow emails

The generated email should contain structured:

-   Recipient
-   Subject
-   Body
-   Case ID
-   Employee/case context
-   Stage
-   Template/version
-   Generation status
-   Agent run ID

## Database/Audit Requirements

Record:

-   Agent invocation
-   Prompt/template version
-   Recipient
-   Subject
-   Body
-   Case/stage context
-   Generation status
-   Error if generation fails
-   Delivery/send status if available

## Important

Verify the actual live execution path.

Do not merely import the email drafting module.

The agent must be invoked during a real workflow.

## SMTP Finding

Real SMTP appears to be wired.

A Gmail `550 5.4.5` daily sending-limit response was observed, proving
that real send attempts are active.

Therefore, if `CLAUDE.md` says emails are only dev-logged and not
delivered, correct that documentation to reflect reality.

------------------------------------------------------------------------

# #7 FAQ Chatbot

Verify that the chatbot genuinely uses RAG over exit-process
documentation.

Confirm:

-   Retrieval actually occurs.
-   Relevant documents are indexed.
-   Retrieved content influences the answer.
-   Answers are grounded in retrieved content.
-   Unsupported questions are handled safely.
-   No hardcoded context is masquerading as RAG.

------------------------------------------------------------------------

# #8 Exit Interview Summarizer

Verify:

-   Exit interview data is actually passed to the agent.
-   Structured summary is generated.
-   Sentiment is calculated.
-   Key themes are extracted.
-   Actionable recommendations are generated.
-   Results are persisted.
-   The LLM output is attributable to an agent run.

------------------------------------------------------------------------

# #9 SLA Escalation Agent

Verify:

-   Overdue clearances are detected.
-   The \>5-day SLA condition is correct.
-   Blocker is identified.
-   Duration is included.
-   Business/process impact is included.
-   Escalation message is generated.
-   Email/notification goes through the Email Drafting Agent.
-   Agent run is recorded.

------------------------------------------------------------------------

# #10 KT Document Reviewer

Verify:

-   Actual KT document is analyzed.
-   Completeness is evaluated.
-   Critical topics are identified.
-   Missing topics are detected.
-   Suggestions are generated.
-   Review result is persisted.
-   Review is tied to the employee/case/document.

------------------------------------------------------------------------

# #11 Smart Routing

Verify routing considers:

-   Availability
-   Workload
-   Delegation
-   OOO status

Verify:

``` text
Primary available → Primary selected
Primary unavailable → Delegate selected
```

Do not permanently modify test OOO/delegation data.

Restore fixtures after testing.

------------------------------------------------------------------------

# #12 Exit Risk Assessment

Verify risk calculation considers relevant:

-   Tenure
-   Role criticality
-   Project dependencies
-   Other required risk signals

Persist:

-   Numeric risk score
-   Risk category
-   Recommendations
-   Evidence/input metadata

## UI Logic

Current evidence showed:

``` text
risk_score = 0.826
```

while the UI rounds it to:

``` text
1
```

If decimal precision is intended, correct only the display logic.

Do not redesign the UI.

------------------------------------------------------------------------

# #13 Compliance Verification

Upgrade compliance from generic stage gating to item-level traceability.

Verify each relevant item individually:

-   Asset return
-   NDA acknowledgment
-   Access revocation
-   Manager approval
-   IT approval
-   Finance approval
-   Other required compliance items

Each item should have:

-   Status
-   Source
-   Timestamp where appropriate
-   Evidence/reference
-   Failure reason if applicable

Maintain RLS.

------------------------------------------------------------------------

# PHASE 2 Acceptance Criteria

Do not move forward until:

-   #6 Email Drafting Agent is invoked in the live workflow.
-   #7 RAG is verified as genuine.
-   #12 risk score/display issue is resolved if required.
-   #13 compliance items are traceable.
-   Existing working agents remain working.
-   Human gates remain intact.
-   RLS remains intact.
-   Tests pass.

Commit the phase.

------------------------------------------------------------------------

# PHASE 3 --- Analytics & Intelligence (#14, #17, #19, #21--#23)

## Scope

Work on:

-   #14 Dashboard Insights
-   #17 Exit Workflow Optimizer
-   #19 Exit Interview Trend Analyst
-   #21 Intelligent Rehire Assessment
-   #22 Policy Compliance Auditor
-   #23 Predictive Attrition

------------------------------------------------------------------------

# Critical Analytics Architecture Fix

Current `analytics_insights` output does not clearly distinguish:

-   Dashboard Insights
-   Workflow Optimizer
-   Policy Compliance Auditor
-   Predictive Attrition

Do not allow multiple agents to produce indistinguishable rows.

Add an appropriate discriminator such as:

``` text
agent_type
```

Recommended values:

``` text
dashboard_insights
workflow_optimizer
policy_compliance_auditor
predictive_attrition
```

Also consider:

-   `run_id`
-   `case_id`
-   `created_at`
-   Reporting period
-   Input metadata
-   Result
-   Recommendations
-   Confidence

Migration must be backward-compatible.

Do not delete historical analytics data.

------------------------------------------------------------------------

# #14 Dashboard Insights

Verify the agent generates:

-   HR dashboard trends
-   Bottlenecks
-   Department patterns
-   Weekly narrative
-   Recommendations

The result must be clearly attributable to:

``` text
agent_type = dashboard_insights
```

------------------------------------------------------------------------

# #17 Exit Workflow Optimizer

Must have an independent workflow-optimization output.

Analyze historical exit data for:

-   Slow stages
-   Bottlenecks
-   Departments with delays
-   SLA patterns
-   Workflow inefficiencies

Produce:

-   Findings
-   Proposed optimization
-   Evidence
-   Confidence

Do not simply reuse #14's output.

------------------------------------------------------------------------

# #19 Exit Interview Trend Analyst

Verify longitudinal analysis of exit interviews.

Identify:

-   Emerging themes
-   Recurring issues
-   Changes over time
-   Trend alerts

Examples may include:

-   Compensation
-   Career growth
-   Management
-   Workload
-   Culture

Output must be independently attributable.

------------------------------------------------------------------------

# #21 Intelligent Rehire Assessment

Verify that the agent actually considers:

-   Performance
-   Exit interview sentiment
-   Manager feedback
-   Employment history
-   Relevant case data

Output:

-   Rehire eligibility
-   Rationale
-   Confidence
-   Evidence

Do not use static or hardcoded eligibility.

------------------------------------------------------------------------

# #22 Policy Compliance Auditor

Create a distinct agent-specific audit output.

Audit active cases for:

-   SLA breaches
-   Missing approvals
-   Skipped steps
-   Missing compliance
-   Policy violations

Output:

-   Cases audited
-   Violations
-   Severity
-   Evidence
-   Recommendations
-   Audit timestamp

Use:

``` text
agent_type = policy_compliance_auditor
```

------------------------------------------------------------------------

# #23 Predictive Attrition

This must be a genuine predictive/risk workflow.

Required conceptual pipeline:

``` text
Data Collector
      ↓
Analyzer / Risk Model
      ↓
Recommendation Generator
```

Use meaningful employee/organizational signals rather than simply
copying dashboard analytics.

Output should include:

-   Risk score
-   Risk category
-   Evidence/features
-   Confidence
-   Recommended retention intervention

Use:

``` text
agent_type = predictive_attrition
```

If the implementation is heuristic rather than ML, clearly document it
as a heuristic risk model.

Do not claim machine learning if it is not actually ML.

------------------------------------------------------------------------

# PHASE 3 Acceptance Criteria

Every intelligence agent must have:

-   Independent identity
-   Independent execution record
-   Agent-specific output
-   Correct `agent_type`
-   Input evidence
-   Result
-   Timestamp
-   Error handling
-   Test coverage

No analytics agent may falsely appear to have executed based only on a
shared analytics row.

Commit the phase.

------------------------------------------------------------------------

# PHASE 4 --- Integrations & Documents (#15, #16, #18)

## Scope

Work on:

-   #15 Multi-System Clearance
-   #16 Document Collection
-   #18 Automated IT Deprovisioning

------------------------------------------------------------------------

# #15 Multi-System Clearance Agent

Create adapter interfaces for:

``` text
HRMSAdapter
ITAMAdapter
FinanceAdapter
```

Each adapter should support:

-   Request
-   Response
-   System identifier
-   Timestamp
-   Status
-   Timeout
-   Error handling
-   Retry behavior where appropriate

Expected states should include:

``` text
CLEARED
PENDING
FAILED
TIMEOUT
```

The agent consolidates the external-system responses.

## Important

If real external systems are unavailable:

-   Use realistic mock adapters.
-   Clearly label them as mocks.
-   Do not pretend they are production APIs.
-   Simulate success/pending/failure/timeout.
-   Keep the adapter contract production-ready.

------------------------------------------------------------------------

# #16 Document Collection Agent

Current OCR testing used a synthetic image.

The production flow must be:

``` text
Employee Upload
      ↓
Document Type Detection
      ↓
OCR / Vision
      ↓
Content & Field Validation
      ↓
Valid / Invalid / Incomplete
      ↓
Persist Result
      ↓
Audit
      ↓
Reminder if Required
```

Validate:

-   Required document type
-   Employee identity where applicable
-   Required fields
-   Dates
-   Signatures/acknowledgments where applicable
-   Document completeness

For invalid documents, persist the reason.

Do not rely on a synthetic test image as the production path.

------------------------------------------------------------------------

# #18 Automated IT Deprovisioning Agent

Required flow:

``` text
Generate Deprovisioning Plan
        ↓
Human Approval
        ↓
Execute Through Adapter
        ↓
Verify Execution
        ↓
Audit
```

The plan may include:

-   Accounts
-   Application access
-   Privileges
-   Devices/assets
-   Archive requirements

## Critical

A task marked `done` is not proof that deprovisioning actually executed.

Verify the execution layer.

If no real IT provider exists:

-   Use a mock IT adapter.
-   Clearly label it as mock.
-   Simulate execution.
-   Verify the resulting mock state.
-   Record the action in the audit trail.

Human approval must remain mandatory.

------------------------------------------------------------------------

# PHASE 4 Acceptance Criteria

-   Adapter architecture exists.
-   External integrations are not falsely represented.
-   Document upload is real and drives OCR/validation.
-   Deprovisioning has plan → approval → execution → verification →
    audit.
-   Failure/timeout paths are tested.
-   Human approval is preserved.
-   RLS/security remains intact.

Commit the phase.

------------------------------------------------------------------------

# PHASE 5 --- Orchestration & Capstone (#20, #24)

## Scope

Work on:

-   #20 Exit Process Orchestrator
-   #24 End-to-End Exit Automation Agent

------------------------------------------------------------------------

# #20 Exit Process Orchestrator

Verify supervisor/hub-and-spoke coordination between:

-   HR
-   Manager
-   IT
-   Finance
-   Email
-   Checklist
-   Compliance
-   Other required agents

Required behavior:

``` text
Start
 ↓
HR
 ↓
Manager / KT
 ↓
IT
 ↓
Finance
 ↓
Compliance
 ↓
Relieving / Completion
```

Actual order should follow the existing business rules.

Verify:

-   Handoffs
-   Retries
-   Rerouting
-   Failures
-   Blocked states
-   Human gates
-   Escalations
-   Rejections
-   Recovery

------------------------------------------------------------------------

# #24 End-to-End Exit Automation Agent

This is the capstone.

The system should coordinate the complete exit journey.

Required scenarios:

## Scenario A --- Happy Path

``` text
Resignation
→ Checklist
→ Manager/KT
→ IT
→ Finance
→ Compliance
→ Relieving
→ Completion
```

Human approvals must occur where required.

------------------------------------------------------------------------

## Scenario B --- Manager Rejection

Verify:

``` text
Manager rejection
→ Workflow detects rejection
→ Correct escalation/rerouting
→ HR handling
→ Recovery or blocked state
```

------------------------------------------------------------------------

## Scenario C --- IT/Finance Failure

Verify:

``` text
Stage failure
→ Error recorded
→ Retry/recovery logic
→ Escalation if necessary
→ No duplicate side effects
```

------------------------------------------------------------------------

## Scenario D --- Approver OOO / Delegation

Verify:

``` text
Primary approver unavailable
→ Smart Routing
→ Delegate
→ Approval
→ Workflow continues
```

------------------------------------------------------------------------

## Scenario E --- Email Failure

Verify:

``` text
Email drafting succeeds
→ Notification/send fails
→ Error recorded
→ Retry or escalation
→ Workflow state remains consistent
```

------------------------------------------------------------------------

# PHASE 5 Acceptance Criteria

The orchestrator must correctly handle:

-   Happy path
-   Rejection
-   Failure
-   Retry
-   Reroute
-   Escalation
-   Human approval
-   Idempotency
-   Auditability

No stage may be marked complete merely because a task row was changed
unless that task change actually represents the intended business
action.



------------------------------------------------------------------------

# PHASE 6 --- Timeline & Required Minimal Frontend Logic

## Strict UI Freeze Continues

Do not redesign the timeline.

Only correct its underlying state/data logic.

------------------------------------------------------------------------

# Required Five Timeline Nodes

The employee timeline should always represent:

1.  Resignation
2.  Manager & KT
3.  IT Clearance
4.  Finance Clearance
5.  Relieving

Do not hide nodes merely because their data does not yet exist.

------------------------------------------------------------------------

# Current Problem

The current implementation uses logic equivalent to:

``` text
STAGE_ORDER.filter(s => tasksByStage[s])
```

This causes a fresh case to show only stages that currently have tasks.

That is misleading.

------------------------------------------------------------------------

# Required Behavior

Always render all five nodes.

Use meaningful states:

``` text
DONE
CURRENT
PENDING
BLOCKED
```

At minimum, distinguish future/not-started nodes from completed nodes.

Do not invent dates.

------------------------------------------------------------------------

# Relieving Date

The Relieving node must use the actual relieving/issuance timestamp,
such as:

``` text
issued_at
```

Do not automatically use:

``` text
last_working_day
```

unless the business rule explicitly says that this is the actual
issuance event.

If the relieving document has not been issued:

``` text
Date = blank
State = PENDING
```

------------------------------------------------------------------------

# Finance Date

If the database has no actual finance completion date:

-   Do not invent one.
-   Show pending/not completed according to state.

------------------------------------------------------------------------

# IT Node

If IT tasks have not yet been generated:

-   Still show the IT node.
-   Mark it as PENDING/NOT STARTED.

------------------------------------------------------------------------

# Visual State

Existing design should remain unchanged.

Only modify the state logic so the existing visual treatment can
represent:

-   Done
-   Current
-   Pending
-   Blocked

If a tiny CSS/state-class change is technically required, keep it
minimal and consistent with the existing design system.

------------------------------------------------------------------------

# PHASE 6 Acceptance Criteria

Verify with:

-   Fresh case
-   Active case
-   Completed case
-   Blocked case
-   Rejected case
-   Case with no IT tasks
-   Case with no Finance completion
-   Case with no relieving issuance
-   Fully completed case

Timeline must always contain the five expected nodes.

Commit the phase.

------------------------------------------------------------------------

# PHASE 7 --- Full QA + 24-Agent Acceptance Test

## Objective

Perform final production-readiness verification after all implementation
phases.

Do not make large architectural changes during this phase.

------------------------------------------------------------------------

# Required Verification Matrix

Produce:

  ------------------------------------------------------------------------------------------------------------------
  \#      Agent            Status   Live         Database   UI         LLM        External      Human   Known
                                    Invocation   Evidence   Evidence   Evidence   Integration   Gate    Limitation
  ------- ---------------- -------- ------------ ---------- ---------- ---------- ------------- ------- ------------
  1       Manager Agent                                                                                 

  2       HR Agent                                                                                      

  3       IT Agent                                                                                      

  4       Finance Agent                                                                                 

  5       Exit Checklist                                                                                
          Generator                                                                                     

  6       Email Drafting                                                                                
          Agent                                                                                         

  7       FAQ Chatbot                                                                                   

  8       Exit Interview                                                                                
          Summarizer                                                                                    

  9       SLA Escalation                                                                                
          Agent                                                                                         

  10      KT Document                                                                                   
          Reviewer                                                                                      

  11      Smart Routing                                                                                 
          Agent                                                                                         

  12      Exit Risk                                                                                     
          Assessment                                                                                    

  13      Compliance                                                                                    
          Verification                                                                                  

  14      Dashboard                                                                                     
          Insights                                                                                      

  15      Multi-System                                                                                  
          Clearance                                                                                     

  16      Document                                                                                      
          Collection                                                                                    

  17      Exit Workflow                                                                                 
          Optimizer                                                                                     

  18      Automated IT                                                                                  
          Deprovisioning                                                                                

  19      Exit Interview                                                                                
          Trend Analyst                                                                                 

  20      Exit Process                                                                                  
          Orchestrator                                                                                  

  21      Intelligent                                                                                   
          Rehire                                                                                        
          Assessment                                                                                    

  22      Policy                                                                                        
          Compliance                                                                                    
          Auditor                                                                                       

  23      Predictive                                                                                    
          Attrition                                                                                     

  24      End-to-End Exit                                                                               
          Automation                                                                                    
  ------------------------------------------------------------------------------------------------------------------

Allowed statuses:

-   FULL
-   PARTIAL
-   MANUAL-BY-DESIGN
-   NOT WORKING

------------------------------------------------------------------------

# Full End-to-End Test Matrix

Test at minimum:

## 1. Happy Path

``` text
Employee resigns
→ Checklist
→ Manager
→ KT
→ IT
→ Finance
→ Compliance
→ Relieving
→ Completion
```

## 2. Manager Rejection

Verify correct escalation and recovery.

## 3. IT Failure

Verify failure state, retry, escalation, and no duplicate execution.

## 4. Finance Failure

Verify settlement failure handling.

## 5. Approver OOO

Verify delegation.

## 6. SLA Breach

Verify escalation.

## 7. Email Failure

Verify notification failure handling.

## 8. Document Invalid

Verify validation failure and reminder.

## 9. External Adapter Timeout

Verify timeout handling.

## 10. Duplicate Retry

Verify idempotency.

------------------------------------------------------------------------

# Security QA

Verify:

-   HR cannot access manager-only data.
-   Manager cannot access unrelated cases.
-   IT sees only IT-authorized data.
-   Finance sees only finance-authorized data.
-   Employees cannot access another employee's data.
-   Service-role operations are restricted.
-   RPC permissions are safe.
-   New tables have appropriate RLS.
-   No API endpoint leaks sensitive data.
-   No secrets are committed.

------------------------------------------------------------------------

# Database QA

Verify:

-   Migrations apply cleanly.
-   Existing data is preserved.
-   New columns are backward-compatible.
-   Constraints are correct.
-   Foreign keys are correct.
-   Indexes exist where required.
-   Unique/idempotency constraints are correct.
-   RLS policies remain correct.

------------------------------------------------------------------------

# LLM / Portkey QA

Verify:

-   Correct model/provider configuration.
-   Prompt/template versioning where required.
-   Agent runs are recorded.
-   Failures are captured.
-   No accidental hardcoded LLM outputs.
-   Inputs are appropriate.
-   Sensitive data is handled safely.
-   LLM calls do not silently bypass agent architecture.

------------------------------------------------------------------------

# Email QA

Verify the real path:

``` text
Agent
→ Email Drafting Agent
→ Generated Email
→ Notification/SMTP
```

Verify:

-   Recipient
-   Subject
-   Body
-   Template/version
-   Case/stage
-   Send status
-   Failure status
-   Retry behavior
-   Audit record

Do not claim email delivery if only generation occurred.

------------------------------------------------------------------------

# Final Production Readiness Report

At the end of Phase 7, produce:

## 1. Executive Summary

Clearly state whether the platform is:

-   Production-ready
-   Conditionally production-ready
-   Not production-ready

------------------------------------------------------------------------

## 2. Files Changed

List every modified file.

For each file explain:

-   Why it changed
-   Which agent/requirement it supports

------------------------------------------------------------------------

## 3. Database Changes

List:

-   Migrations
-   Tables
-   Columns
-   Indexes
-   RPCs
-   Views
-   RLS changes

------------------------------------------------------------------------

## 4. Architecture Changes

Document:

-   Agent routing
-   Orchestration
-   Email flow
-   Adapter architecture
-   Document processing
-   Deprovisioning
-   Analytics separation

------------------------------------------------------------------------

## 5. UI Changes

Because of the UI freeze, this should be minimal.

List only actual frontend logic/state changes.

Explicitly confirm:

``` text
UI design/layout/theme were preserved.
```

------------------------------------------------------------------------

## 6. Testing Results

Include:

-   Unit tests
-   Integration tests
-   End-to-end tests
-   Database tests
-   RLS/security tests
-   Agent tests
-   Failure/retry tests
-   Idempotency tests

------------------------------------------------------------------------

## 7. Final 24-Agent Matrix

Complete the required matrix with evidence.

Do not mark an agent FULL without evidence.

------------------------------------------------------------------------

## 8. Known Limitations

Clearly separate:

-   Production functionality
-   Mock functionality
-   Demo functionality
-   Manual-by-design functionality
-   Remaining limitations

Never hide limitations.

------------------------------------------------------------------------

# Final Rules

1.  **Do not rebuild working functionality.**
2.  **Do not redesign the UI.**
3.  **Do not fake external integrations.**
4.  **Do not bypass human approval gates.**
5.  **Do not claim an agent works because its source file exists.**
6.  **Verify live invocation.**
7.  **Use real database evidence.**
8.  **Keep RLS/security intact.**
9.  **Make agent execution auditable.**
10. **Make retries idempotent.**
11. **Use safe migrations.**
12. **Clearly label mocks.**
13. **Fix the Email Drafting Agent's live-path bypass.**
14. **Separate analytics agents with identifiable outputs.**
15. **Make document collection upload-driven.**
16. **Verify actual IT deprovisioning execution.**
17. **Keep the timeline data-driven and complete.**
18. **Use actual relieving issuance data.**
19. **Test happy paths and failure paths.**
20. **Accuracy \> appearance of completeness.**

------------------------------------------------------------------------

# Phase Completion Rule

After every phase:

``` text
1. Run tests.
2. Inspect changed files.
3. Inspect database changes.
4. Verify no unintended UI changes.
5. Verify security/RLS.
6. Verify agent execution.
7. Review errors.
8. Commit the completed phase.
9. Push to GitHub.
10. Only then proceed to the next phase.
```

The implementation should proceed **one phase at a time**.

Do not jump ahead unless the current phase passes its acceptance
criteria.
