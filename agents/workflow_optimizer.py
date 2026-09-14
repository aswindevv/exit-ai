"""Agent #17 -- Exit Workflow Optimizer (agent_requirements.md #17 / blueprint1.md #17).

"Analyzes historical exit data, identifies bottlenecks (which stages take longest,
which departments delay), and proposes workflow reconfigurations." Independent
bottleneck computation: reuses sla_escalation.find_breaches (real overdue-task
arithmetic, already used by policy_auditor.py for the same reason) to compute
per-stage/per-department overdue-day totals -- this is NOT a copy of #14's
dashboard-wide stats (cases_by_department/cases_by_status/etc). Does NOT
reimplement or modify sla_escalation.py or analytics_agent.py.

Run (from repo root, with agents/.venv active):
    python -m agents.workflow_optimizer
    python -m agents.workflow_optimizer --self-check
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import date

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from .config import db
from .llm import ask_claude
from .sla_escalation import find_breaches
from .trace import log_db, traced_node

SYSTEM_PROMPT = (
    "You are an HR operations analyst. Given aggregate offboarding bottleneck stats "
    "(already computed -- do not do any arithmetic yourself), identify which pipeline "
    "stages and departments are the biggest bottlenecks and propose 2-3 concrete "
    "workflow reconfigurations to reduce delay. Plain prose, no markdown, no restating "
    "the raw numbers verbatim."
)


def bottleneck_stats(breaches: list[dict]) -> dict:
    """Pure function: sla_escalation breaches in -> bottleneck-focused stats out
    (overdue-day totals per stage/department, not #14's dashboard-wide counts)."""
    overdue_days_by_stage: Counter = Counter()
    overdue_days_by_department: Counter = Counter()
    stalled_cases: set[str] = set()
    for b in breaches:
        overdue_days_by_stage[b["stage"]] += b["days_overdue"]
        dept = b["impact"].rsplit("(", 1)[-1].rstrip(")") if "(" in b["impact"] else None
        if dept:
            overdue_days_by_department[dept] += b["days_overdue"]
        stalled_cases.add(b["case_id"])
    worst_stage = overdue_days_by_stage.most_common(1)[0][0] if overdue_days_by_stage else None
    return {
        "breach_count": len(breaches),
        "stalled_case_count": len(stalled_cases),
        "overdue_days_by_stage": dict(overdue_days_by_stage),
        "overdue_days_by_department": dict(overdue_days_by_department),
        "worst_stage": worst_stage,
    }


class OptimizerState(TypedDict):
    stats: dict
    narrative: str


@traced_node("Exit Workflow Optimizer -- aggregate (reuses sla_escalation.find_breaches)")
def _aggregate(state: OptimizerState) -> OptimizerState:
    tasks = db.table("exit_tasks").select("id, case_id, stage, title, status, due_date").eq("status", "pending").execute().data or []
    cases = {c["id"]: c for c in db.table("exit_cases").select("id, employee_name, department, hr_id, manager_id").execute().data or []}
    profiles = {p["id"]: p for p in db.table("profiles").select("id, full_name").execute().data or []}
    breaches = find_breaches(tasks, cases, profiles, date.today())
    state["stats"] = bottleneck_stats(breaches)
    return state


@traced_node("Exit Workflow Optimizer -- narrate")
def _narrate(state: OptimizerState) -> OptimizerState:
    state["narrative"] = ask_claude(SYSTEM_PROMPT, f"Stats:\n{state['stats']}")
    return state


@traced_node("Exit Workflow Optimizer -- persist")
def _persist(state: OptimizerState) -> OptimizerState:
    db.table("analytics_insights").insert({
        "narrative": state["narrative"],
        "stats": state["stats"],
        "agent_type": "workflow_optimizer",
    }).execute()
    log_db("insert", "analytics_insights", rows=1)
    return state


_graph = StateGraph(OptimizerState)
_graph.add_node("aggregate", _aggregate)
_graph.add_node("narrate", _narrate)
_graph.add_node("persist", _persist)
_graph.set_entry_point("aggregate")
_graph.add_edge("aggregate", "narrate")
_graph.add_edge("narrate", "persist")
_graph.set_finish_point("persist")
optimizer_graph = _graph.compile()


def run() -> dict:
    return optimizer_graph.invoke({"stats": {}, "narrative": ""})


def _demo() -> None:
    """Pure-arithmetic self-check, no network -- run with --self-check."""
    breaches = [
        {"case_id": "c1", "stage": "hr", "days_overdue": 5, "impact": "blocks final clearance for A (Engineering)"},
        {"case_id": "c1", "stage": "hr", "days_overdue": 3, "impact": "blocks final clearance for A (Engineering)"},
        {"case_id": "c2", "stage": "it", "days_overdue": 24, "impact": "blocks final clearance for B (Finance)"},
    ]
    stats = bottleneck_stats(breaches)
    assert stats["breach_count"] == 3 and stats["stalled_case_count"] == 2, stats
    assert stats["overdue_days_by_stage"] == {"hr": 8, "it": 24}, stats
    assert stats["overdue_days_by_department"] == {"Engineering": 8, "Finance": 24}, stats
    assert stats["worst_stage"] == "it", stats
    print("workflow_optimizer self-check passed:", stats)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    else:
        print(run())
