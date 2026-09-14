"""Agent #24 -- End-to-End Exit Automation (Capstone) (agent_requirements.md #24 /
agents_spec.md #24).

REUSE-only: composes the existing pipeline into one autonomous start->finish run.
Does not reimplement hr/manager/it/compliance/finance/assess logic, rejection
handling, notifications, or SLA-breach detection -- all of that already exists and is
called here, not rewritten:
  - service.activate_case(case_id)   -- real initiation (checklist + resignation
    notice + status -> in_progress), the same entry the frontend resignation flow
    uses. Reports {"error": ...} instead of raising when the case doesn't exist.
  - supervisor.run_case(...)         -- hr -> manager gate -> it -> compliance ->
    finance -> assess. Already branches a rejected manager gate to its own escalate
    node instead of continuing/crashing (simulate_rejection=True below exercises
    exactly that branch) -- no new escalation logic needed.
  - sla_escalation.find_breaches + its _escalate node -- reused as-is, but scoped to
    THIS case's own pending tasks, not sla_escalation.run()'s global scan across every
    case (which would escalate unrelated cases as a side effect of driving this one).
  - notifications.py fires naturally as a side effect of the above (resignation
    notice, completion notice) -- no new notification code here.

After the pipeline runs, reads back the real compliance/finance task rows those
agents wrote to decide the outcome: exit_cases.status -> 'completed' only when both
actually cleared; a rejection, a not-found case, or a blocked compliance/finance
stage all end in a clear {"status": "blocked", "reason": ...} instead of a crash or
a silently-reported success.

Run (from repo root, with agents/.venv active, PYTHONIOENCODING=utf-8 on Windows):
    python -m agents.e2e_automation <case_id>
    python -m agents.e2e_automation <case_id> --reject
"""
from __future__ import annotations

import sys
from datetime import date

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import service, sla_escalation, supervisor
from .config import db
from .trace import log_db, traced_node

DEFAULT_KT_TEXT = (
    "Handover doc: covers the deployment runbook and on-call rotation. "
    "Missing: escalation contacts for the payments vendor integration."
)
DEFAULT_INTERVIEW_TEXT = (
    "The employee said the main reason for leaving was better compensation "
    "elsewhere. They felt supported by their manager and would consider "
    "returning in the future."
)


class E2EState(TypedDict):
    case_id: str
    kt_text: str | None
    interview_text: str | None
    simulate_rejection: bool
    initiation: dict
    pipeline: dict
    sla: dict
    outcome: dict


@traced_node("E2E -- initiate")
def _initiate(state: E2EState) -> E2EState:
    state["initiation"] = service.activate_case(state["case_id"])
    return state


@traced_node("E2E -- coordinate stages")
def _coordinate(state: E2EState) -> E2EState:
    if state["initiation"].get("error"):
        state["pipeline"] = {"skipped": state["initiation"]["error"]}
        return state
    state["pipeline"] = supervisor.run_case(
        state["case_id"],
        kt_text=state.get("kt_text"),
        interview_text=state.get("interview_text"),
        simulate_rejection=state["simulate_rejection"],
    )
    return state


@traced_node("E2E -- SLA breach check (this case only)")
def _sla_check(state: E2EState) -> E2EState:
    case_id = state["case_id"]
    if state["initiation"].get("error"):
        state["sla"] = {"skipped": "case not found"}
        return state

    tasks = (
        db.table("exit_tasks").select("id, case_id, stage, title, status, due_date")
        .eq("case_id", case_id).eq("status", "pending").execute().data or []
    )
    case_row = db.table("exit_cases").select("id, employee_name, department, hr_id, manager_id") \
        .eq("id", case_id).single().execute().data or {}
    cases = {case_row["id"]: case_row} if case_row else {}
    profile_ids = [pid for pid in {case_row.get("hr_id"), case_row.get("manager_id")} if pid]
    profiles = (
        {p["id"]: p for p in db.table("profiles").select("id, full_name").in_("id", profile_ids).execute().data}
        if profile_ids else {}
    )
    breaches = sla_escalation.find_breaches(tasks, cases, profiles, date.today())
    escalated = sla_escalation._escalate({"breaches": breaches, "escalated": 0})["escalated"]
    state["sla"] = {"breaches_found": len(breaches), "escalated": escalated}
    return state


@traced_node("E2E -- finalize")
def _finalize(state: E2EState) -> E2EState:
    case_id = state["case_id"]

    if state["initiation"].get("error"):
        state["outcome"] = {"status": "blocked", "reason": state["initiation"]["error"]}
        return state
    if state["simulate_rejection"]:
        state["outcome"] = {"status": "blocked", "reason": "manager rejected KT plan -- escalated to HR"}
        return state

    compliance_row = db.table("exit_tasks").select("status, title").eq("case_id", case_id).eq("stage", "compliance").execute().data
    finance_row = db.table("exit_tasks").select("status, title").eq("case_id", case_id).eq("stage", "finance").execute().data
    compliance_done = bool(compliance_row) and compliance_row[0]["status"] == "done"
    finance_done = bool(finance_row) and finance_row[0]["status"] == "done"

    if compliance_done and finance_done:
        db.table("exit_cases").update({"status": "completed"}).eq("id", case_id).execute()
        log_db("update", "exit_cases", rows=1, detail="status -> completed")
        state["outcome"] = {"status": "completed"}
    else:
        blocking = []
        if not compliance_done:
            blocking.append(compliance_row[0]["title"] if compliance_row else "compliance: not run")
        if not finance_done:
            blocking.append(finance_row[0]["title"] if finance_row else "finance: not run")
        state["outcome"] = {"status": "blocked", "reason": "; ".join(blocking)}

    db.table("agent_runs").insert(
        {"case_id": case_id, "stage": "e2e_automation", "detail": f"final outcome: {state['outcome']}"}
    ).execute()
    log_db("insert", "agent_runs", rows=1, detail=str(state["outcome"]))
    return state


_graph = StateGraph(E2EState)
_graph.add_node("initiate", _initiate)
_graph.add_node("coordinate", _coordinate)
_graph.add_node("sla_check", _sla_check)
_graph.add_node("finalize", _finalize)
_graph.set_entry_point("initiate")
_graph.add_edge("initiate", "coordinate")
_graph.add_edge("coordinate", "sla_check")
_graph.add_edge("sla_check", "finalize")
_graph.set_finish_point("finalize")
e2e_graph = _graph.compile()


@traced_node("E2E Automation -- run case start to finish")
def run(case_id: str, *, kt_text: str | None = None, interview_text: str | None = None,
        simulate_rejection: bool = False) -> dict:
    return e2e_graph.invoke({
        "case_id": case_id,
        "kt_text": kt_text if kt_text is not None else DEFAULT_KT_TEXT,
        "interview_text": interview_text if interview_text is not None else DEFAULT_INTERVIEW_TEXT,
        "simulate_rejection": simulate_rejection,
        "initiation": {}, "pipeline": {}, "sla": {}, "outcome": {},
    })


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    result = run(sys.argv[1], simulate_rejection="--reject" in sys.argv[2:])
    print("\nfinal outcome:", result["outcome"])
