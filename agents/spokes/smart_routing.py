"""Agent #11 -- Smart Routing (docs/agent_requirements.md #11 / blueprint1.md #11).

NEW. Picks the real approver profile for a clearance stage (hr/manager/it),
preferring a department match and skipping anyone with out_of_office=true
(0012_profiles_out_of_office.sql) in favour of a delegate. Real logic on
real data: no synthetic "availability" score, no invented department split
-- department preference and OOO status are both real columns on `profiles`,
queried live.

Delegate data: this demo seeds exactly one named hr/manager/it account each
(Siva/Aravidhan/Aswin, scripts/seed/seed.js) plus one REAL delegate account per
role (scripts/seed/seed_delegates.js: hr.delegate@/manager.delegate@/
it.delegate@) so there is always a second real profile to route to -- not a
placeholder string. Ordering is by profiles.created_at (the originally
seeded account is always earlier), so "primary" vs "delegate" falls out of
real insert order, not a hardcoded name.

# ponytail: department-match is real logic, but no profile in this dataset
# currently has a non-null department for hr/manager/it (only employees do),
# so that branch always falls through to the full candidate pool today.
# Upgrade: once per-department approvers exist, this starts choosing between
# them for real with zero code changes.

Wired as a tool: supervisor.py calls pick_approver() from the hr/manager/it
stage nodes (not a new top-level graph node) -- see agents/hub/supervisor.py.

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.smart_routing <case_id> <stage>   # stage: hr|manager|it
    python -m agents.spokes.smart_routing --self-check
"""
from __future__ import annotations

import sys

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from ..core.config import db
from ..core.trace import log_db, traced_node


def select_approver(candidates: list[dict], department: str | None) -> dict:
    """Pure function: ordered candidate profiles (earliest-created first) +
    a case department in -> routing decision out. No I/O, no LLM."""
    if not candidates:
        return {"approver": None, "is_delegate": False, "all_ooo": False, "reason": "no profiles hold this stage's role"}

    # Prefer a candidate from the same department as the exiting employee (if any).
    # In practice, hr/manager/it profiles have no department set yet, so this
    # always falls through to the full candidate list — see module docstring.
    dept_matches = [c for c in candidates if department and c.get("department") == department]
    pool = dept_matches or candidates
    # Filter out anyone marked out_of_office; remaining list is in created_at order.
    available = [c for c in pool if not c.get("out_of_office")]

    if available:
        chosen = available[0]
        # pool[0] is the "primary" (earliest-created); if we picked someone else, it's a delegate.
        is_delegate = chosen["id"] != pool[0]["id"]
        reason = (f"primary ({pool[0]['full_name']}) is out_of_office -> routed to delegate"
                  if is_delegate else "primary approver available")
        return {"approver": chosen, "is_delegate": is_delegate, "all_ooo": False, "reason": reason}

    # All candidates are OOO — default to the primary rather than blocking the pipeline.
    chosen = pool[0]
    return {"approver": chosen, "is_delegate": False, "all_ooo": True,
            "reason": "every candidate is out_of_office -> defaulted to primary (no one actually available)"}


class RoutingState(TypedDict):
    case_id: str
    stage: str
    department: str | None   # filled by _fetch from the case row
    _candidates: list[dict]  # all profiles whose role matches the stage
    decision: dict


@traced_node("Smart Routing -- fetch case + candidate approvers")
def _fetch(state: RoutingState) -> RoutingState:
    # Read the case's department (to prefer a dept-matched approver) and
    # all profiles for the requested stage role, ordered by creation date.
    case = db.table("exit_cases").select("department").eq("id", state["case_id"]).single().execute().data
    candidates = (
        db.table("profiles").select("id, full_name, email, department, out_of_office, created_at")
        .eq("role", state["stage"]).order("created_at").execute().data
    ) or []
    state["department"] = case.get("department") if case else None
    state["_candidates"] = candidates
    return state


@traced_node("Smart Routing -- select approver")
def _select(state: RoutingState) -> RoutingState:
    # select_approver() is pure — all the decision logic lives there so it can
    # be tested independently without needing a real database (see _demo()).
    decision = select_approver(state["_candidates"], state["department"])
    state["decision"] = decision
    approver = decision["approver"]
    detail = f"stage={state['stage']} approver={approver['full_name'] if approver else None} " \
             f"is_delegate={decision['is_delegate']} reason={decision['reason']}"
    # Write one audit row so the supervisor and HR can see who was selected and why.
    db.table("agent_runs").insert({"case_id": state["case_id"], "stage": "smart_routing", "detail": detail}).execute()
    log_db("insert", "agent_runs", rows=1, detail=detail)
    return state


# Two-node graph: fetch (DB read) -> select (pure logic + audit write).
_graph = StateGraph(RoutingState)
_graph.add_node("fetch", _fetch)
_graph.add_node("select", _select)
_graph.set_entry_point("fetch")
_graph.add_edge("fetch", "select")
_graph.set_finish_point("select")
smart_routing_graph = _graph.compile()


def pick_approver(case_id: str, stage: str) -> dict:
    """The tool entry point supervisor.py calls from a stage node."""
    result = smart_routing_graph.invoke({"case_id": case_id, "stage": stage, "department": None, "_candidates": [], "decision": {}})
    return result["decision"]


def _demo() -> None:
    """Pure-logic self-check, no network -- run with --self-check."""
    primary = {"id": "p1", "full_name": "Siva", "department": None, "out_of_office": False}
    delegate = {"id": "p2", "full_name": "Divya (HR Delegate)", "department": None, "out_of_office": False}

    d = select_approver([primary, delegate], None)
    assert d["approver"]["id"] == "p1" and not d["is_delegate"], d

    ooo_primary = {**primary, "out_of_office": True}
    d = select_approver([ooo_primary, delegate], None)
    assert d["approver"]["id"] == "p2" and d["is_delegate"] and not d["all_ooo"], d

    d = select_approver([ooo_primary, {**delegate, "out_of_office": True}], None)
    assert d["approver"]["id"] == "p1" and d["all_ooo"], d

    eng_delegate = {"id": "p3", "full_name": "Eng Specialist", "department": "Engineering", "out_of_office": False}
    d = select_approver([primary, delegate, eng_delegate], "Engineering")
    assert d["approver"]["id"] == "p3", d  # department match preferred over earlier-created generic candidates

    print("smart_routing self-check passed:", {"primary_available": select_approver([primary, delegate], None),
                                                "primary_ooo": select_approver([ooo_primary, delegate], None)})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    elif len(sys.argv) > 2:
        print(pick_approver(sys.argv[1], sys.argv[2]))
    else:
        print(__doc__)
        sys.exit(1)
