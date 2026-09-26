# ─── What this file does ─────────────────────────────────────────────────────
# The Finance agent checks whether a departing employee's financial dues are
# cleared. It uses NO AI -- the check is purely deterministic: all prior stages
# (HR, manager, IT) must be done AND the Finance team must have manually marked
# dues as settled. If both conditions are met, it marks the finance task done.
# ─────────────────────────────────────────────────────────────────────────────
"""Agent #4 -- Finance agent.

Blueprint calls this one out as *not* a heavy reasoning agent -- "a tool-using
node that checks financial clearance... keep it a tool call the supervisor
invokes." So no LLM here, just a deterministic check wrapped in the same
compiled-subgraph shape as the others (one node) so the supervisor can invoke
it uniformly.

Real dues check (0013_finance_role.sql): clearance now requires BOTH every
other stage (hr, manager, it) done AND exit_cases.finance_cleared = true --
the real flag the Finance dashboard's "Mark dues settled" button writes
(FinanceLayout.jsx). Prior stages done but dues not yet confirmed blocks with
reason "dues/settlement not confirmed", same "block with the specific reason
named" posture as compliance_agent.

Ensures a stage='finance' task exists (creating the seed-style
"Clear final settlement dues" task if missing), then marks it done once
hr/manager/it are all done AND finance_cleared is true, pending otherwise.

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.finance_agent <case_id>
"""
from __future__ import annotations

import sys

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import email_drafting_agent
from ..core.config import db
from ..core.trace import log_db, traced_node


class FinanceState(TypedDict):
    case_id: str
    result: dict


@traced_node("Finance agent -- check clearance")
def _check_clearance(state: FinanceState) -> FinanceState:
    case_id = state["case_id"]
    # Fetch all HR, manager, and IT tasks for this case.
    # "all(...)" returns True only if every task's status is "done".
    other_tasks = db.table("exit_tasks").select("title, status, stage, escalation_state").eq("case_id", case_id).in_(
        "stage", ["hr", "manager", "it"]
    ).execute().data or []
    # Escalation markers are workflow records, not clearance work. Open ones
    # block; rerouted/resolved ones are ignored and the underlying KT rows
    # remain the manager gate's source of truth.
    gate_tasks = [
        t for t in other_tasks
        if not ((t.get("title") or "").startswith("Escalated") and t.get("escalation_state") in ("rerouted", "resolved"))
    ]
    stages_done = bool(gate_tasks) and all(t["status"] == "done" for t in gate_tasks)

    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data or {}
    # finance_cleared is set by the Finance dashboard's "Mark dues settled" button.
    dues_settled = bool(case.get("finance_cleared"))
    # Both conditions must be true: all prior work done AND finance manually confirmed.
    cleared = stages_done and dues_settled
    reason = None if cleared else ("dues/settlement not confirmed" if stages_done else "prior stages not complete")
    title = "Clear final settlement dues" if cleared else f"Clear final settlement dues -- blocked: {reason}"

    finance_tasks = db.table("exit_tasks").select("id, status").eq("case_id", case_id).eq("stage", "finance").execute().data or []
    if not finance_tasks:
        # No finance task exists yet -- create one with the right initial status.
        db.table("exit_tasks").insert({
            "case_id": case_id, "stage": "finance", "title": title,
            "status": "done" if cleared else "pending",
        }).execute()
        log_db("insert", "exit_tasks", rows=1)
        newly_cleared = cleared   # it's a new "done" row, so this is a fresh clearance
    else:
        new_status = "done" if cleared else "pending"
        # newly_cleared: True only on the first time we flip from pending -> done.
        # If it was already "done" on every previous run, this evaluates to False
        # and we skip the completion email -- avoiding re-sends on every re-check.
        newly_cleared = cleared and any(t["status"] != new_status for t in finance_tasks)
        for t in finance_tasks:
            db.table("exit_tasks").update({"status": new_status, "title": title}).eq("id", t["id"]).execute()
        log_db("update", "exit_tasks", rows=len(finance_tasks), detail=f"status={new_status}")

    # Clearance completes: notify only on the pending -> done transition, not
    # on every re-run once it's already settled.
    if newly_cleared and case:
        email_drafting_agent.completion_notice(case)

    state["result"] = {"cleared": cleared, "reason": reason}
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
