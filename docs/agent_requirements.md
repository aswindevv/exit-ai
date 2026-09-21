# Agent Requirements — Exit AI

The authoritative list of the 24 required agents (company brief). This is the
source of truth for what each agent must do. Build each agent to its description here.

---

1. **Manager Agent** — represents the manager role in the clearance process (a human
   approval role, realized as the manager approval gate, not an LLM agent).

2. **HR Agent** — handles HR-side clearance for an exit case (checklist, KT, documents).

3. **IT Agent** — handles IT-side clearance for an exit case (deprovisioning).

4. **Finance Agent** — handles finance-side clearance (financial clearance).

5. **Exit Checklist Generator Agent** — takes employee role/department and
   auto-generates a personalized exit checklist (assets to return, access to revoke,
   KT topics).

6. **Email Drafting Agent** — drafts stage-specific notification emails (KT reminder,
   overdue warning, completion) using LLM prompts with structured templates.

7. **FAQ Chatbot for Exit Process** — a conversational agent that answers employee
   questions about the exit process (timelines, steps, documents needed) using RAG
   over process docs.

8. **Exit Interview Summarizer** — reads exit interview submissions and produces a
   structured summary with sentiment analysis, key themes, and actionable
   recommendations.

9. **SLA Escalation Agent** — monitors overdue clearances (>5 days) and autonomously
   composes escalation messages with context (who is blocking, how long, impact).

10. **KT Document Reviewer Agent** — reviews Knowledge Transfer documents for
    completeness: checks if critical topics are covered, identifies gaps, suggests
    additions based on role.

11. **Smart Routing Agent** — determines the optimal approver for each clearance stage
    based on availability, workload, and delegation rules (handles out-of-office).

12. **Exit Risk Assessment Agent** — analyzes the exiting employee profile (tenure,
    role criticality, project dependencies) and assigns a risk score with recommended
    mitigation actions.

13. **Compliance Verification Agent** — verifies all compliance requirements before
    final clearance: checks asset return, NDA acknowledgment, access revocation
    confirmation.

14. **Dashboard Insights Agent** — analyzes HR dashboard data (trends, bottlenecks,
    department patterns) and generates weekly narrative reports with recommendations.

15. **Multi-System Clearance Agent** — tool-use capabilities that call APIs (IT asset
    management, HRMS, finance) to verify clearances across systems and consolidate
    status.

16. **Document Collection Agent** — identifies required documents for an exit case,
    checks which are submitted, sends reminders for missing ones, and validates uploads
    using vision/OCR.

17. **Exit Workflow Optimizer Agent** — analyzes historical exit data, identifies
    bottlenecks (which stages take longest, which departments delay), and proposes
    workflow reconfigurations.

18. **Automated IT Deprovisioning Agent** — generates and executes IT deprovisioning
    plans (list accounts to disable, access to revoke, data to archive) with
    human-in-the-loop approval.

19. **Exit Interview Trend Analyst Agent** — a multi-turn agent that conducts
    longitudinal analysis of exit interviews, identifies emerging patterns (rising
    complaints in a department), and generates alerts.

20. **Exit Process Orchestrator (Multi-Agent)** — a multi-agent system where separate
    agents handle each clearance stage (IT Agent, Finance Agent, HR Agent) coordinated
    by a supervisor agent managing handoffs.

21. **Intelligent Rehire Assessment Agent** — evaluates whether an exiting employee
    should be flagged as eligible for rehire based on performance, exit interview
    sentiment, and manager feedback.

22. **Policy Compliance Auditor Agent** — an autonomous agent that periodically audits
    all active exit cases against company policy (SLA breaches, missing approvals,
    skipped steps) and generates reports.

23. **Predictive Attrition Agent** — a multi-agent pipeline: a Data Collector gathers
    signals, an Analyzer identifies at-risk employees, and a Recommendation Agent
    suggests retention interventions on scheduled triggers.

24. **End-to-End Exit Automation Agent (Capstone)** — a fully autonomous agent that
    initiates the exit process, coordinates all stages, handles exceptions (rejections,
    escalations, re-routing), and communicates with stakeholders.
