"""Agent #17 -- Exit Workflow Optimizer (agent_requirements.md #17 / blueprint1.md #17).

"Analyzes historical exit data, identifies bottlenecks (which stages take longest,
which departments delay), and proposes workflow reconfigurations." REUSE: reuses
analytics_agent's own aggregate node (pending_tasks_by_stage, cases_by_department are
exactly the bottleneck signals this needs) -- this module wraps that same arithmetic
with its own reconfiguration-focused narrative and its own analytics_insights row.
Does NOT reimplement or modify analytics_agent.py.

Run (from repo root, with agents/.venv active):
    python -m agents.workflow_optimizer
"""
from __future__ import annotations

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import analytics_agent
from .config import db
from .llm import ask_claude
from .trace import log_db, traced_node

SYSTEM_PROMPT = (
    "You are an HR operations analyst. Given aggregate offboarding stats (already "
    "computed -- do not do any arithmetic yourself), identify which pipeline stages "
    "and departments are the biggest bottlenecks and propose 2-3 concrete workflow "
    "reconfigurations to reduce delay. Plain prose, no markdown, no restating the "
    "raw numbers verbatim."
)


class OptimizerState(TypedDict):
    stats: dict
    narrative: str


@traced_node("Exit Workflow Optimizer -- aggregate (reuses analytics_agent)")
def _aggregate(state: OptimizerState) -> OptimizerState:
    state["stats"] = analytics_agent._aggregate({"stats": {}, "narrative": ""})["stats"]
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


if __name__ == "__main__":
    print(run())
