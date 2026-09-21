"""Agent #9 -- Analytics.

Aggregation is plain Python/Counter arithmetic over exit_cases/exit_tasks --
never the LLM. The LLM's only job is turning that stats dict into a short
narrative for the HR insights panel. Three-node compiled LangGraph subgraph:
aggregate -> narrate -> persist.

Run (from repo root, with agents/.venv active):
    python -m agents.analytics.analytics_agent
"""
from __future__ import annotations

from collections import Counter

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from ..core.config import db
from ..core.llm import ask_claude
from ..core.prompts import load_prompt
from ..core.trace import log_db, traced_node

SYSTEM_PROMPT = load_prompt("analytics/dashboard_insights_system.md")


class AnalyticsState(TypedDict):
    stats: dict
    narrative: str


@traced_node("Analytics -- aggregate")
def _aggregate(state: AnalyticsState) -> AnalyticsState:
    cases = db.table("exit_cases").select("department, status, risk_level").execute().data or []
    tasks = db.table("exit_tasks").select("case_id, status, stage").execute().data or []

    by_department = Counter(c["department"] for c in cases)
    by_status = Counter(c["status"] for c in cases)
    by_risk = Counter(c["risk_level"] for c in cases if c.get("risk_level"))

    pending_by_stage = Counter(t["stage"] for t in tasks if t["status"] != "done")
    total_tasks = len(tasks)
    done_tasks = sum(1 for t in tasks if t["status"] == "done")

    state["stats"] = {
        "total_cases": len(cases),
        "cases_by_department": dict(by_department),
        "cases_by_status": dict(by_status),
        "cases_by_risk_level": dict(by_risk),
        "pending_tasks_by_stage": dict(pending_by_stage),
        "task_completion_rate": round(done_tasks / total_tasks, 2) if total_tasks else None,
    }
    return state


@traced_node("Analytics -- narrate")
def _narrate(state: AnalyticsState) -> AnalyticsState:
    state["narrative"] = ask_claude(SYSTEM_PROMPT, f"Stats:\n{state['stats']}")
    return state


@traced_node("Analytics -- persist")
def _persist(state: AnalyticsState) -> AnalyticsState:
    db.table("analytics_insights").insert({
        "narrative": state["narrative"],
        "stats": state["stats"],
        "agent_type": "dashboard_insights",
    }).execute()
    log_db("insert", "analytics_insights", rows=1)
    return state


_graph = StateGraph(AnalyticsState)
_graph.add_node("aggregate", _aggregate)
_graph.add_node("narrate", _narrate)
_graph.add_node("persist", _persist)
_graph.set_entry_point("aggregate")
_graph.add_edge("aggregate", "narrate")
_graph.add_edge("narrate", "persist")
_graph.set_finish_point("persist")
analytics_graph = _graph.compile()


def run() -> dict:
    return analytics_graph.invoke({"stats": {}, "narrative": ""})


if __name__ == "__main__":
    print(run())
