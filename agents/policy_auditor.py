"""Agent #22 -- Policy Compliance Auditor (agent_requirements.md #22 / blueprint1.md #22).

NEW. "An autonomous agent that periodically audits all active exit cases
against company policy (SLA breaches, missing approvals, skipped steps) and
generates reports." Realized as a three-node subgraph (gather -> audit ->
report), same shape as the rest of the analytics/escalation family. Reuses
sla_escalation.find_breaches for the SLA-breach check rather than
reimplementing overdue-detection arithmetic a second time.

Three checks per active case, all pure Python against real rows -- no LLM
arithmetic:
  sla_breach        -- pending task >=5 days overdue (sla_escalation.find_breaches)
  missing_approval  -- case has it/finance-stage tasks (i.e. progressed past
                       the manager gate) but no agent_runs row logging that
                       gate's approval for this case
  skipped_step      -- case has a finance-stage task but no compliance-stage
                       task/agent_runs row -- the NDA/asset/access check
                       (compliance_agent, #13) never ran before finance

Run (from repo root, with agents/.venv active):
    python -m agents.policy_auditor
    python -m agents.policy_auditor --self-check
"""
from __future__ import annotations

import sys
from datetime import date

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from .config import db
from .llm import ask_claude
from .sla_escalation import find_breaches
from .trace import log_db, traced_node

ACTIVE_STATUSES = {"open", "in_progress"}

SYSTEM_PROMPT = (
    "You are a compliance auditor summarizing a policy audit of offboarding cases. "
    "You are given the exact breaches already found (already computed -- do not do "
    "any arithmetic or invent breaches yourself). Write 3-5 sentences: overall health, "
    "which breach type is most common, and one concrete process fix. Plain prose, no markdown."
)


def audit_cases(
    cases: list[dict],
    tasks_by_case: dict[str, list[dict]],
    all_tasks_by_case: dict[str, list[dict]],
    approvals_by_case: dict[str, bool],
    today: date,
) -> dict:
    """Pure function: active cases + their tasks/approvals in -> a breach
    list out, tagged by check type. See module docstring for what each
    check means."""
    cases_by_id = {c["id"]: c for c in cases}
    profiles: dict[str, dict] = {}  # sla_escalation only needs names for hr/manager -- filled by caller if desired
    breaches: list[dict] = []

    for c in cases:
        cid = c["id"]
        stages_present = {t["stage"] for t in all_tasks_by_case.get(cid, [])}

        for b in find_breaches(tasks_by_case.get(cid, []), cases_by_id, profiles, today):
            breaches.append({"check": "sla_breach", "case_id": cid, "employee_name": c["employee_name"], "detail": b})

        progressed = bool({"it", "finance"} & stages_present)
        if progressed and not approvals_by_case.get(cid, False):
            breaches.append({
                "check": "missing_approval", "case_id": cid, "employee_name": c["employee_name"],
                "detail": "it/finance-stage tasks exist with no logged manager-gate approval for this case",
            })

        if "finance" in stages_present and "compliance" not in stages_present:
            breaches.append({
                "check": "skipped_step", "case_id": cid, "employee_name": c["employee_name"],
                "detail": "finance-stage task exists but compliance check (#13) never ran for this case",
            })

    by_check: dict[str, int] = {}
    for b in breaches:
        by_check[b["check"]] = by_check.get(b["check"], 0) + 1

    return {
        "cases_audited": len(cases),
        "breach_count": len(breaches),
        "breaches_by_check": by_check,
        "breaches": breaches,
    }


class AuditorState(TypedDict):
    report: dict
    narrative: str
    _active: list[dict]
    _tasks_by_case: dict[str, list[dict]]
    _all_tasks_by_case: dict[str, list[dict]]
    _approvals_by_case: dict[str, bool]


@traced_node("Policy Auditor -- gather active cases")
def _gather(state: AuditorState) -> AuditorState:
    cases = db.table("exit_cases").select("id, employee_name, department, hr_id, manager_id, status").execute().data or []
    active = [c for c in cases if c.get("status") in ACTIVE_STATUSES]
    case_ids = [c["id"] for c in active]

    all_tasks = db.table("exit_tasks").select("id, case_id, stage, title, status, due_date").execute().data or []
    tasks_by_case: dict[str, list[dict]] = {}
    all_tasks_by_case: dict[str, list[dict]] = {}
    for t in all_tasks:
        if t["case_id"] in case_ids:
            all_tasks_by_case.setdefault(t["case_id"], []).append(t)
            if t["status"] == "pending":
                tasks_by_case.setdefault(t["case_id"], []).append(t)

    runs = db.table("agent_runs").select("case_id, stage, detail").execute().data or []
    approvals_by_case = {
        r["case_id"]: True for r in runs if r["stage"] == "manager" and r.get("detail") == "approved"
    }

    state["_active"] = active
    state["_tasks_by_case"] = tasks_by_case
    state["_all_tasks_by_case"] = all_tasks_by_case
    state["_approvals_by_case"] = approvals_by_case
    return state


@traced_node("Policy Auditor -- audit")
def _audit(state: AuditorState) -> AuditorState:
    state["report"] = audit_cases(
        state["_active"], state["_tasks_by_case"], state["_all_tasks_by_case"],
        state["_approvals_by_case"], date.today(),
    )
    return state


@traced_node("Policy Auditor -- report")
def _report(state: AuditorState) -> AuditorState:
    report = state["report"]
    if report["breaches"]:
        state["narrative"] = ask_claude(SYSTEM_PROMPT, f"Audit report:\n{report}")
    else:
        state["narrative"] = "No policy breaches found across active cases in this audit."
    db.table("analytics_insights").insert({
        "narrative": state["narrative"], "stats": report, "agent_type": "policy_compliance_auditor",
    }).execute()
    log_db("insert", "analytics_insights", rows=1)
    return state


_graph = StateGraph(AuditorState)
_graph.add_node("gather", _gather)
_graph.add_node("audit", _audit)
_graph.add_node("report", _report)
_graph.set_entry_point("gather")
_graph.add_edge("gather", "audit")
_graph.add_edge("audit", "report")
_graph.set_finish_point("report")
auditor_graph = _graph.compile()


def run() -> dict:
    return auditor_graph.invoke({"report": {}, "narrative": ""})


def _demo() -> None:
    """Pure-arithmetic self-check, no network -- run with --self-check."""
    today = date(2026, 9, 13)
    cases = [
        {"id": "c1", "employee_name": "Clean Case", "department": "Sales", "hr_id": "h", "manager_id": "m", "status": "in_progress"},
        {"id": "c2", "employee_name": "No Approval", "department": "IT", "hr_id": "h", "manager_id": "m", "status": "in_progress"},
        {"id": "c3", "employee_name": "Skipped Compliance", "department": "Finance", "hr_id": "h", "manager_id": "m", "status": "in_progress"},
    ]
    all_tasks_by_case = {
        "c1": [{"stage": "hr"}, {"stage": "manager"}, {"stage": "it"}, {"stage": "compliance"}, {"stage": "finance"}],
        "c2": [{"stage": "hr"}, {"stage": "manager"}, {"stage": "it"}, {"stage": "compliance"}, {"stage": "finance"}],
        "c3": [{"stage": "hr"}, {"stage": "manager"}, {"stage": "it"}, {"stage": "finance"}],
    }
    tasks_by_case: dict[str, list[dict]] = {}  # no pending-overdue tasks in this fixture -- isolates the other two checks
    approvals_by_case = {"c1": True, "c3": True}  # c2 deliberately missing

    report = audit_cases(cases, tasks_by_case, all_tasks_by_case, approvals_by_case, today)
    checks = {(b["case_id"], b["check"]) for b in report["breaches"]}
    assert checks == {("c2", "missing_approval"), ("c3", "skipped_step")}, report
    assert report["cases_audited"] == 3 and report["breach_count"] == 2, report
    print("policy_auditor self-check passed:", report)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    else:
        print(run())
