"""Agent #4 -- Finance agent.

Blueprint calls this one out as *not* a heavy reasoning agent -- "a tool-using
node that checks financial clearance... keep it a tool call the supervisor
invokes." So no LLM here, just a deterministic check wrapped in the same
compiled-subgraph shape as the others (one node) so the supervisor can invoke
it uniformly.

# ponytail: no dues/reimbursements ledger table exists in the schema (checked
# exit_cases, exit_tasks -- no finance-specific columns). Proxying "financial
# clearance" by whether every other stage (hr, manager, it) is done for the
# case -- reasonable for a demo where settlement follows clearance elsewhere.
# Upgrade: real dues/reimbursements table once one exists.

Ensures a stage='finance' task exists (creating the seed-style
"Clear final settlement dues" task if missing), then marks it done once
hr/manager/it are all done, pending otherwise.

Run (from repo root, with agents/.venv active):
    python -m agents.finance_agent <case_id>
"""
from __future__ import annotations

import sys

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import notifications
from .config import db
from .trace import log_db, traced_node


class FinanceState(TypedDict):
    case_id: str
    result: dict


@traced_node("Finance agent -- check clearance")
def _check_clearance(state: FinanceState) -> FinanceState:
    case_id = state["case_id"]
    other_tasks = db.table("exit_tasks").select("status, stage").eq("case_id", case_id).in_(
        "stage", ["hr", "manager", "it"]
    ).execute().data or []
    cleared = bool(other_tasks) and all(t["status"] == "done" for t in other_tasks)

    finance_tasks = db.table("exit_tasks").select("id, status").eq("case_id", case_id).eq("stage", "finance").execute().data or []
    if not finance_tasks:
        row = db.table("exit_tasks").insert({
            "case_id": case_id, "stage": "finance", "title": "Clear final settlement dues",
            "status": "done" if cleared else "pending",
        }).execute().data
        log_db("insert", "exit_tasks", rows=1)
        newly_cleared = cleared
    else:
        new_status = "done" if cleared else "pending"
        newly_cleared = cleared and any(t["status"] != new_status for t in finance_tasks)
        for t in finance_tasks:
            if t["status"] != new_status:
                db.table("exit_tasks").update({"status": new_status}).eq("id", t["id"]).execute()
        log_db("update", "exit_tasks", rows=len(finance_tasks), detail=f"status={new_status}")

    # Clearance completes: notify only on the pending -> done transition, not
    # on every re-run once it's already settled.
    if newly_cleared:
        case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
        if case:
            notifications.send_completion_notice(case)

    state["result"] = {"cleared": cleared}
    return state


_graph = StateGraph(FinanceState)
_graph.add_node("check", _check_clearance)
_graph.set_entry_point("check")
_graph.set_finish_point("check")
finance_graph = _graph.compile()


def check_clearance(case_id: str) -> dict:
    return finance_graph.invoke({"case_id": case_id, "result": {}})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    print(check_clearance(sys.argv[1]))
