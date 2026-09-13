"""Agent #9 -- SLA Escalation (agent_requirements.md #9 / blueprint1.md #9).

REUSE: wraps notifications.py's existing overdue-scan pattern (it already
knows how to find "pending + past due_date" tasks) with its own >5-day
escalation threshold and its own message -- an escalation naming who is
blocking, how long, and the downstream impact -- composed via
notifications._compose/_send (not a fresh formatter) and sent to the actual
blocker (HR/manager) rather than the employee, which is check_overdue's
audience. Does NOT reimplement or modify notifications.py.

Run (from repo root, with agents/.venv active):
    python -m agents.sla_escalation
    python -m agents.sla_escalation --self-check
"""
from __future__ import annotations

import sys
from datetime import date

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import notifications
from .config import db
from .trace import log_db, traced_node

THRESHOLD_DAYS = 5

# ponytail: no per-case assignee exists for it/finance/compliance stages (no
# "finance" role in profiles, and it/compliance tasks aren't assigned to a
# specific person per case) -- name the real assignee where the schema has
# one (hr stage -> case.hr_id, manager stage -> case.manager_id), else name
# the responsible team generically. Upgrade: add a per-task assignee column
# once ownership is tracked at that granularity.
STAGE_TEAM = {"it": "the IT team", "finance": "the Finance team", "compliance": "the HR/Compliance team"}


def find_breaches(tasks: list[dict], cases: dict[str, dict], profiles: dict[str, dict], today: date) -> list[dict]:
    """Pure function: pending tasks + their cases/blockers in -> breaches
    (>=THRESHOLD_DAYS overdue) out, each naming the blocker, duration and
    impact. No I/O, no LLM -- everything here is arithmetic/lookups."""
    breaches = []
    for t in tasks:
        if t.get("status") != "pending" or not t.get("due_date"):
            continue
        due = t["due_date"] if isinstance(t["due_date"], date) else date.fromisoformat(t["due_date"])
        days_overdue = (today - due).days
        if days_overdue < THRESHOLD_DAYS:
            continue
        case = cases.get(t["case_id"])
        if not case:
            continue
        stage = t["stage"]
        if stage == "hr":
            blocker = profiles.get(case.get("hr_id"), {}).get("full_name") or "HR"
        elif stage == "manager":
            blocker = profiles.get(case.get("manager_id"), {}).get("full_name") or "the manager"
        else:
            blocker = STAGE_TEAM.get(stage, f"the {stage} team")
        breaches.append({
            "task_id": t["id"], "case_id": t["case_id"], "stage": stage, "title": t["title"],
            "days_overdue": days_overdue, "blocker": blocker,
            "employee_name": case["employee_name"],
            "impact": f"blocks final clearance for {case['employee_name']} ({case.get('department', 'n/a')})",
            "hr_id": case.get("hr_id"), "manager_id": case.get("manager_id"),
        })
    return breaches


class SLAState(TypedDict):
    breaches: list[dict]
    escalated: int


@traced_node("SLA Escalation -- scan overdue clearances")
def _gather(state: SLAState) -> SLAState:
    tasks = (
        db.table("exit_tasks").select("id, case_id, stage, title, status, due_date")
        .eq("status", "pending").execute().data or []
    )
    cases = {
        c["id"]: c for c in
        db.table("exit_cases").select("id, employee_name, department, hr_id, manager_id").execute().data or []
    }
    profiles = {p["id"]: p for p in db.table("profiles").select("id, full_name").execute().data or []}
    state["breaches"] = find_breaches(tasks, cases, profiles, date.today())
    return state


@traced_node("SLA Escalation -- compose & send")
def _escalate(state: SLAState) -> SLAState:
    escalated = 0
    for b in state["breaches"]:
        subject = f"SLA escalation: {b['employee_name']}'s {b['stage']} task is {b['days_overdue']}d overdue"
        intro = (
            f"\"{b['title']}\" ({b['employee_name']}'s {b['stage']} stage) has been pending "
            f"{b['days_overdue']} days past its due date, blocked on {b['blocker']}."
        )
        lines = [f"Impact: {b['impact']}"]
        body = notifications._compose(b["blocker"], intro, lines, "Please resolve or reassign this task.")
        to = None
        if b["stage"] == "hr":
            to = notifications._profile_email(b.get("hr_id"))
        elif b["stage"] == "manager":
            to = notifications._profile_email(b.get("manager_id"))
        if to:
            notifications._send(to, subject, body)
        else:
            print(f"[escalation:dev-log] no resolvable email for {b['blocker']} -- subject={subject}\n{body}\n")
        db.table("agent_runs").insert({
            "case_id": b["case_id"], "stage": "sla_escalation",
            "detail": f"{b['stage']} task {b['days_overdue']}d overdue, blocked on {b['blocker']}",
        }).execute()
        escalated += 1
    log_db("insert", "agent_runs", rows=escalated, detail="sla_escalation")
    state["escalated"] = escalated
    return state


_graph = StateGraph(SLAState)
_graph.add_node("gather", _gather)
_graph.add_node("escalate", _escalate)
_graph.set_entry_point("gather")
_graph.add_edge("gather", "escalate")
_graph.set_finish_point("escalate")
sla_escalation_graph = _graph.compile()


def run() -> dict:
    return sla_escalation_graph.invoke({"breaches": [], "escalated": 0})


def _demo() -> None:
    """Pure-arithmetic self-check, no network -- run with --self-check."""
    today = date(2026, 9, 13)
    cases = {
        "c1": {"employee_name": "Test One", "department": "Engineering", "hr_id": "hr1", "manager_id": "mgr1"},
        "c2": {"employee_name": "Test Two", "department": "Finance", "hr_id": "hr1", "manager_id": "mgr1"},
    }
    profiles = {"hr1": {"full_name": "Harper HR"}, "mgr1": {"full_name": "Morgan Manager"}}
    tasks = [
        {"id": "t1", "case_id": "c1", "stage": "hr", "title": "Overdue by exactly threshold",
         "status": "pending", "due_date": "2026-09-08"},          # 5 days -- boundary, IS a breach
        {"id": "t2", "case_id": "c1", "stage": "manager", "title": "Not yet overdue enough",
         "status": "pending", "due_date": "2026-09-10"},          # 3 days -- not a breach
        {"id": "t3", "case_id": "c2", "stage": "it", "title": "Long overdue IT step",
         "status": "pending", "due_date": "2026-08-20"},          # 24 days -- breach, no per-case assignee
        {"id": "t4", "case_id": "c2", "stage": "hr", "title": "Already done", "status": "done",
         "due_date": "2026-08-01"},                                 # done -- excluded regardless of date
    ]
    breaches = find_breaches(tasks, cases, profiles, today)
    by_task = {b["task_id"]: b for b in breaches}
    assert set(by_task) == {"t1", "t3"}, breaches
    assert by_task["t1"]["days_overdue"] == 5 and by_task["t1"]["blocker"] == "Harper HR", by_task["t1"]
    assert by_task["t3"]["days_overdue"] == 24 and by_task["t3"]["blocker"] == "the IT team", by_task["t3"]
    print("sla_escalation self-check passed:", breaches)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    else:
        print(run())
