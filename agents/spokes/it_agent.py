# ─── What this file does ─────────────────────────────────────────────────────
# The IT agent asks the AI to generate a deprovisioning plan (which accounts to
# disable, which assets to collect) and saves those items as exit_tasks in the
# database. IT staff then see and approve them on their dashboard. The agent
# only ever proposes tasks -- it never executes them; a human must approve first.
# ─────────────────────────────────────────────────────────────────────────────
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
    python -m agents.spokes.it_agent <case_id>
"""
from __future__ import annotations

import sys
from datetime import date

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from ..core.config import db
from ..core.llm import ask_claude_json
from ..core.prompts import load_prompt
from ..core.trace import log_db, traced_node

# Load the AI's instruction file -- tells it to generate deprovisioning tasks
# using keywords that match the IT dashboard's categorization buckets.
SYSTEM_PROMPT = load_prompt("it/deprovisioning_system.md")


# Shared state that flows through the two-node graph below (generate → persist).
class ItPlanState(TypedDict):
    case_id: str    # UUID of the exit case
    case: dict      # full exit_cases row (role_title, department, last_working_day)
    result: dict    # AI's JSON response; filled by generate, consumed by persist


@traced_node("IT agent -- generate deprovisioning plan")
def _generate_plan(state: ItPlanState) -> ItPlanState:
    case = state["case"]
    # Tell the AI the employee's role and department so it can generate
    # role-appropriate deprovisioning tasks (e.g. "Revoke GitHub access" for Engineering).
    user = f"Role: {case['role_title']}\nDepartment: {case['department']}"
    state["result"] = ask_claude_json(SYSTEM_PROMPT, user)
    return state


@traced_node("IT agent -- persist deprovisioning plan")
def _persist_plan(state: ItPlanState) -> ItPlanState:
    case_id = state["case_id"]
    last_day = date.fromisoformat(state["case"]["last_working_day"])
    # Build a database row for each task the AI generated.
    # stage="it" routes these rows to the IT dashboard (ItPages.jsx reads stage='it').
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


# Public entry point. Idempotent: if IT tasks already exist for this case,
# it returns early instead of inserting duplicates. This makes it safe to
# call multiple times (e.g., re-running the pipeline after a partial failure).
def generate_plan(case_id: str, force: bool = False) -> dict:
    """Idempotent unless force=True: skips if stage='it' tasks already exist."""
    if not force:
        existing = db.table("exit_tasks").select("id").eq("case_id", case_id).eq("stage", "it").execute().data
        if existing:
            return {"skipped": True, "reason": "it tasks already exist"}
    # Fetch the full case row from the database, then run the graph.
    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    return it_plan_graph.invoke({"case_id": case_id, "case": case, "result": {}})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    print(generate_plan(sys.argv[1]))
