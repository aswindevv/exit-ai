"""Agent #15 -- Multi-System Clearance (agent_requirements.md #15 / blueprint1.md #15).

NEW-min. "Consolidates clearance status across multiple systems (IT asset
management, HRMS, finance)." Those three external systems don't exist in this
project -- there is one Supabase project, not three integrated platforms --
so this is a DEMO STAND-IN: OUR OWN Supabase tables play the role of each
external system, queried live and for real (no hardcoded/fake status).
Stays labeled NEW-min (not DONE) until real external-system credentials
exist; see agents_spec.md.

Stand-in mapping (each one is a REAL query, not a mock):
    "IT asset management" -> exit_tasks where stage='it'
                             (+ case_documents: Asset Return Form / Company
                             Asset Declaration -- the asset-side paperwork)
    "HRMS"                -> exit_tasks where stage='hr'
                             (+ case_documents: NDA)
    "finance"              -> exit_tasks where stage='finance'
All three tables are real, already-written-to tables in THIS project
(finance_agent.py, it_deprovisioning_agent, checklist_generator_agent,
doc_collection.py) -- this agent only reads and consolidates, writes nothing
to them.

Wired as a tool: supervisor.py calls consolidate() from the compliance stage
node (not a new top-level graph node) -- see agents/supervisor.py.

Run (from repo root, with agents/.venv active):
    python -m agents.multi_system_clearance <case_id>
    python -m agents.multi_system_clearance --self-check
"""
from __future__ import annotations

import sys
from collections import defaultdict

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from .config import db
from .trace import log_db, traced_node


def system_status(tasks: list[dict]) -> dict:
    """Pure function: a stage's exit_tasks rows in -> that stand-in system's
    clearance status out. No task at all for a stage reads as pending, not
    cleared -- a stage that never ran isn't cleared."""
    if not tasks:
        return {"status": "pending", "open_items": ["no task recorded yet"]}
    open_items = [t["title"] for t in tasks if t["status"] != "done"]
    return {"status": "cleared" if not open_items else "pending", "open_items": open_items}


def consolidate_status(tasks_by_stage: dict[str, list[dict]], doc_rows: list[dict]) -> dict:
    """Pure function: real exit_tasks (grouped by stage) + real case_documents
    rows in -> one consolidated status object out. No I/O, no LLM."""
    it = system_status(tasks_by_stage.get("it", []))
    hr = system_status(tasks_by_stage.get("hr", []))
    finance = system_status(tasks_by_stage.get("finance", []))
    doc_issues = [f"{d['doc_type']}: {d['status']}" for d in doc_rows if d["status"] != "validated"]
    overall = "cleared" if doc_issues == [] and all(s["status"] == "cleared" for s in (it, hr, finance)) else "pending"
    return {
        "it_asset_management": it,  # stand-in: exit_tasks stage='it'
        "hrms": hr,                 # stand-in: exit_tasks stage='hr'
        "finance": finance,         # stand-in: exit_tasks stage='finance'
        "document_issues": doc_issues,
        "overall": overall,
    }


class ClearanceState(TypedDict):
    case_id: str
    _tasks_by_stage: dict[str, list[dict]]
    _doc_rows: list[dict]
    status: dict


@traced_node("Multi-System Clearance -- fetch stand-in systems")
def _fetch(state: ClearanceState) -> ClearanceState:
    tasks = db.table("exit_tasks").select("stage, title, status").eq("case_id", state["case_id"]).execute().data or []
    by_stage: dict[str, list[dict]] = defaultdict(list)
    for t in tasks:
        by_stage[t["stage"]].append(t)
    docs = db.table("case_documents").select("doc_type, status").eq("case_id", state["case_id"]).execute().data or []
    state["_tasks_by_stage"] = dict(by_stage)
    state["_doc_rows"] = docs
    return state


@traced_node("Multi-System Clearance -- consolidate")
def _consolidate(state: ClearanceState) -> ClearanceState:
    status = consolidate_status(state["_tasks_by_stage"], state["_doc_rows"])
    state["status"] = status
    detail = f"overall={status['overall']} it={status['it_asset_management']['status']} " \
             f"hrms={status['hrms']['status']} finance={status['finance']['status']}"
    db.table("agent_runs").insert({"case_id": state["case_id"], "stage": "multi_system_clearance", "detail": detail}).execute()
    log_db("insert", "agent_runs", rows=1, detail=detail)
    return state


_graph = StateGraph(ClearanceState)
_graph.add_node("fetch", _fetch)
_graph.add_node("consolidate", _consolidate)
_graph.set_entry_point("fetch")
_graph.add_edge("fetch", "consolidate")
_graph.set_finish_point("consolidate")
multi_system_clearance_graph = _graph.compile()


def consolidate(case_id: str) -> dict:
    """The tool entry point supervisor.py calls from the compliance stage node."""
    result = multi_system_clearance_graph.invoke({"case_id": case_id, "_tasks_by_stage": {}, "_doc_rows": [], "status": {}})
    return result["status"]


def _demo() -> None:
    """Pure-logic self-check, no network -- run with --self-check."""
    all_done = {
        "it": [{"title": "Return laptop", "status": "done"}],
        "hr": [{"title": "Exit interview", "status": "done"}],
        "finance": [{"title": "Clear dues", "status": "done"}],
    }
    docs_ok = [{"doc_type": "NDA", "status": "validated"}]
    s = consolidate_status(all_done, docs_ok)
    assert s["overall"] == "cleared", s

    pending_it = {**all_done, "it": [{"title": "Return laptop", "status": "pending"}]}
    s2 = consolidate_status(pending_it, docs_ok)
    assert s2["overall"] == "pending" and s2["it_asset_management"]["status"] == "pending", s2

    s3 = consolidate_status(all_done, [{"doc_type": "NDA", "status": "rejected"}])
    assert s3["overall"] == "pending" and s3["document_issues"] == ["NDA: rejected"], s3

    s4 = consolidate_status({}, [])
    assert s4["overall"] == "pending" and s4["hrms"]["open_items"] == ["no task recorded yet"], s4

    print("multi_system_clearance self-check passed:", {"cleared_case": s, "pending_it": s2, "doc_issue": s3})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    elif len(sys.argv) > 1:
        print(consolidate(sys.argv[1]))
    else:
        print(__doc__)
        sys.exit(1)
