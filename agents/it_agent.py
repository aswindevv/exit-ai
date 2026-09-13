"""Agent #3 -- IT agent.

Generates a deprovisioning plan (accounts to disable, access to revoke,
assets to collect) as stage='it' exit_tasks. Never writes status='done' --
ItDashboard.jsx's "Approve" button is the human-in-the-loop step; the agent
only ever proposes, it never executes.

Titles must hit ItDashboard.jsx's own keyword buckets (checked that file --
no schema/frontend change needed, it already regex-categorizes by title):
    ASSET_RE          laptop|macbook|device|headset|card|asset|collect
    "Identity and SSO" sso|identity|account
    "Source control"    repo|repository|source|git
    (else falls into the "SaaS applications" catch-all bucket)
The system prompt below tells the LLM to use exactly those words.

Run (from repo root, with agents/.venv active):
    python -m agents.it_agent <case_id>
"""
from __future__ import annotations

import sys
from datetime import date

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from .config import db
from .llm import ask_claude_json
from .trace import log_db, traced_node

SYSTEM_PROMPT = (
    "You generate an IT deprovisioning plan for an exiting employee. Return "
    "ONLY a JSON object with key 'tasks': a list of 3-6 short imperative task "
    "titles covering account/access revocation and asset collection, tailored "
    "to the employee's role and department. Use concrete words so each task "
    "sorts correctly in a checklist: for asset items mention 'laptop', "
    "'access card' or 'device'; for identity/account access say 'SSO' or "
    "'account'; for developer/source access say 'repo' or 'git'; for any "
    "other application access, name the application."
)


class ItPlanState(TypedDict):
    case_id: str
    case: dict
    result: dict


@traced_node("IT agent -- generate deprovisioning plan")
def _generate_plan(state: ItPlanState) -> ItPlanState:
    case = state["case"]
    user = f"Role: {case['role_title']}\nDepartment: {case['department']}"
    state["result"] = ask_claude_json(SYSTEM_PROMPT, user)
    return state


@traced_node("IT agent -- persist deprovisioning plan")
def _persist_plan(state: ItPlanState) -> ItPlanState:
    case_id = state["case_id"]
    last_day = date.fromisoformat(state["case"]["last_working_day"])
    rows = [
        {"case_id": case_id, "stage": "it", "title": t, "status": "pending", "due_date": last_day.isoformat()}
        for t in state["result"].get("tasks", [])
    ]
    if rows:
        db.table("exit_tasks").insert(rows).execute()
    log_db("insert", "exit_tasks", rows=len(rows))
    return state


_graph = StateGraph(ItPlanState)
_graph.add_node("generate", _generate_plan)
_graph.add_node("persist", _persist_plan)
_graph.set_entry_point("generate")
_graph.add_edge("generate", "persist")
_graph.set_finish_point("persist")
it_plan_graph = _graph.compile()


def generate_plan(case_id: str, force: bool = False) -> dict:
    """Idempotent unless force=True: skips if stage='it' tasks already exist."""
    if not force:
        existing = db.table("exit_tasks").select("id").eq("case_id", case_id).eq("stage", "it").execute().data
        if existing:
            return {"skipped": True, "reason": "it tasks already exist"}
    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    return it_plan_graph.invoke({"case_id": case_id, "case": case, "result": {}})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    print(generate_plan(sys.argv[1]))
