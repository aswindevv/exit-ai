"""Agent #13 -- Compliance Verification (agent_requirements.md #13 / blueprint1.md #13).

NEW: split from risk/finance. Verifies asset return, NDA acknowledgment, and access
revocation are all done before final clearance -- deterministic keyword match over
exit_tasks (no dedicated NDA/asset schema exists yet, same proxying style as
finance_agent's clearance check). Blocks by leaving a stage='compliance' task pending
with the specific missing/incomplete items named; never auto-clears past a human,
same posture as it_agent/finance_agent. Idempotent: updates the same task row instead
of piling up duplicates.

Run (from repo root, with agents/.venv active):
    python -m agents.compliance_agent --self-check
    python -m agents.compliance_agent <case_id>
"""
from __future__ import annotations

import re
import sys

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from .config import db
from .trace import log_db, traced_node

CHECKS = {
    "asset return": re.compile(r"laptop|macbook|device|headset|asset|equipment|collect", re.I),
    "NDA": re.compile(r"\bnda\b|non-disclosure|confidentiality", re.I),
    "access revoked": re.compile(r"\baccess\b|\bsso\b|\baccount\b|revoke|deprovision", re.I),
}


def evaluate(tasks: list[dict]) -> dict:
    """Pure function: which of the three compliance checks are satisfied. A check
    with no matching task at all counts as missing (blocks), not N/A."""
    blocking = []
    for label, pattern in CHECKS.items():
        matches = [t for t in tasks if pattern.search(t.get("title", ""))]
        if not matches:
            blocking.append(f"{label}: no task found")
        elif any(t.get("status") != "done" for t in matches):
            blocking.append(f"{label}: pending")
    return {"cleared": not blocking, "blocking_reasons": blocking}


class ComplianceState(TypedDict):
    case_id: str
    result: dict


@traced_node("Compliance Verification -- check")
def _check_node(state: ComplianceState) -> ComplianceState:
    tasks = db.table("exit_tasks").select("title, status").eq("case_id", state["case_id"]).execute().data or []
    state["result"] = evaluate(tasks)
    return state


@traced_node("Compliance Verification -- persist")
def _persist_node(state: ComplianceState) -> ComplianceState:
    case_id = state["case_id"]
    result = state["result"]
    status = "done" if result["cleared"] else "pending"
    title = (
        "Compliance verified -- cleared for final clearance" if result["cleared"]
        else "Final clearance blocked: " + "; ".join(result["blocking_reasons"])
    )
    existing = db.table("exit_tasks").select("id").eq("case_id", case_id).eq("stage", "compliance").execute().data
    if existing:
        db.table("exit_tasks").update({"title": title, "status": status}).eq("id", existing[0]["id"]).execute()
        log_db("update", "exit_tasks", rows=1, detail=title)
    else:
        db.table("exit_tasks").insert(
            {"case_id": case_id, "stage": "compliance", "title": title, "status": status}
        ).execute()
        log_db("insert", "exit_tasks", rows=1, detail=title)
    return state


_graph = StateGraph(ComplianceState)
_graph.add_node("check", _check_node)
_graph.add_node("persist", _persist_node)
_graph.set_entry_point("check")
_graph.add_edge("check", "persist")
_graph.set_finish_point("persist")
compliance_graph = _graph.compile()


def run_for_case(case_id: str) -> dict:
    return compliance_graph.invoke({"case_id": case_id, "result": {}})


def _demo() -> None:
    """Pure-arithmetic self-check, no network -- run with --self-check."""
    missing_nda = evaluate([
        {"title": "Return laptop and access card", "status": "done"},
        {"title": "Revoke SSO account access", "status": "done"},
    ])
    assert not missing_nda["cleared"] and any("NDA" in r for r in missing_nda["blocking_reasons"]), missing_nda

    pending_nda = evaluate([
        {"title": "Sign NDA acknowledgment", "status": "pending"},
        {"title": "Return laptop", "status": "done"},
        {"title": "Revoke account access", "status": "done"},
    ])
    assert not pending_nda["cleared"] and any("NDA" in r for r in pending_nda["blocking_reasons"]), pending_nda

    clear = evaluate([
        {"title": "Sign NDA acknowledgment", "status": "done"},
        {"title": "Return laptop", "status": "done"},
        {"title": "Revoke account access", "status": "done"},
    ])
    assert clear["cleared"] and not clear["blocking_reasons"], clear

    print("compliance_agent self-check passed:", missing_nda, pending_nda, clear)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "--self-check":
        _demo()
    else:
        print(run_for_case(sys.argv[1]))
