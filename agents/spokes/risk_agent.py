"""Agent #8 -- Compliance & Risk.

Deterministic scoring (tenure, role criticality, interview sentiment,
outstanding tasks) -- no LLM. Wrapped as a two-node compiled LangGraph
subgraph (score -> persist) so it fits the same "every agent is a subgraph"
shape as the others, even though a plain function would do the math just
as well.

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.risk_agent --self-check
    python -m agents.spokes.risk_agent <case_id>
    python -m agents.spokes.risk_agent --all
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from ..core.config import db
from ..core.trace import log_db, traced_node

# ponytail: no hire_date/tenure column exists anywhere in the schema (checked
# profiles + exit_cases). Proxying tenure from profiles.created_at -- fine for
# this demo since seed data is all freshly created "today" (so every case
# reads as low tenure). Upgrade: add a real hire_date column once onboarding
# data exists.
DEPARTMENT_CRITICALITY = {
    "Engineering": 0.9,
    "Sales": 0.6,
    "Marketing": 0.5,
    "Finance": 0.8,
    "Support": 0.5,
    "Product": 0.8,
    "Operations": 0.6,
    "HR": 0.7,
}
SENTIMENT_RISK = {"negative": 1.0, "neutral": 0.5, "positive": 0.1}
WEIGHTS = {"tenure": 0.2, "role": 0.3, "sentiment": 0.3, "tasks": 0.2}


def _tenure_risk(created_at: str | None) -> float:
    """Shorter tenure -> higher risk (less institutional investment to lose).
    Proxy for the missing hire_date column -- see module docstring."""
    if not created_at:
        return 0.5
    created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    days = (datetime.now(timezone.utc) - created).days
    if days < 90:
        return 0.9
    if days < 365:
        return 0.6
    return 0.3


def _tasks_risk(total: int, done: int) -> float:
    if total == 0:
        return 0.0
    return round((total - done) / total, 2)


def score(case: dict, profile: dict | None, interview: dict | None, tasks: list[dict]) -> dict:
    tenure = _tenure_risk(profile.get("created_at") if profile else None)
    role = DEPARTMENT_CRITICALITY.get(case.get("department"), 0.5)
    sentiment = SENTIMENT_RISK.get((interview or {}).get("sentiment"), 0.5)
    total_tasks = len(tasks)
    done_tasks = sum(1 for t in tasks if t.get("status") == "done")
    tasks_risk = _tasks_risk(total_tasks, done_tasks)

    risk_score = round(
        tenure * WEIGHTS["tenure"]
        + role * WEIGHTS["role"]
        + sentiment * WEIGHTS["sentiment"]
        + tasks_risk * WEIGHTS["tasks"],
        3,
    )
    risk_level = "high" if risk_score >= 0.66 else "medium" if risk_score >= 0.4 else "low"
    rehire_eligible = (interview or {}).get("rehire_eligible", risk_level != "high")

    return {"risk_score": risk_score, "risk_level": risk_level, "rehire_eligible": rehire_eligible}


class RiskState(TypedDict):
    case_id: str
    result: dict


@traced_node("Compliance & Risk -- score")
def _score_node(state: RiskState) -> RiskState:
    case_id = state["case_id"]
    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    profile = (
        db.table("profiles").select("created_at").eq("employee_id", case["employee_id"]).limit(1).execute().data
        if case.get("employee_id")
        else None
    )
    profile = profile[0] if profile else None
    interview = db.table("exit_interviews").select("sentiment, rehire_eligible").eq("case_id", case_id).execute().data
    tasks = db.table("exit_tasks").select("status").eq("case_id", case_id).execute().data or []
    state["result"] = score(case, profile, interview[0] if interview else None, tasks)
    return state


@traced_node("Compliance & Risk -- persist")
def _persist_node(state: RiskState) -> RiskState:
    db.table("exit_cases").update(state["result"]).eq("id", state["case_id"]).execute()
    log_db("update", "exit_cases", rows=1, detail=str(state["result"]))
    # Same "own agent_runs row" pattern smart_routing/rehire_agent already use,
    # so risk scoring has an audit trail too, not just the exit_cases write.
    r = state["result"]
    detail = f"score={r['risk_score']} level={r['risk_level']} rehire_eligible={r['rehire_eligible']}"
    db.table("agent_runs").insert({"case_id": state["case_id"], "stage": "risk", "detail": detail}).execute()
    log_db("insert", "agent_runs", rows=1, detail=detail)
    return state


_graph = StateGraph(RiskState)
_graph.add_node("score", _score_node)
_graph.add_node("persist", _persist_node)
_graph.set_entry_point("score")
_graph.add_edge("score", "persist")
_graph.set_finish_point("persist")
risk_graph = _graph.compile()


def run_for_case(case_id: str) -> dict:
    return risk_graph.invoke({"case_id": case_id, "result": {}})


def run_for_all() -> list[dict]:
    cases = db.table("exit_cases").select("id").execute().data or []
    return [run_for_case(c["id"]) for c in cases]


def _demo() -> None:
    """Pure-arithmetic self-check, no network -- run with --self-check."""
    high = score(
        {"department": "Engineering"},
        {"created_at": datetime.now(timezone.utc).isoformat()},
        {"sentiment": "negative", "rehire_eligible": False},
        [{"status": "pending"}, {"status": "pending"}, {"status": "done"}],
    )
    assert high["risk_level"] == "high", high

    low = score(
        {"department": "Support"},
        {"created_at": "2020-01-01T00:00:00Z"},
        {"sentiment": "positive", "rehire_eligible": True},
        [{"status": "done"}, {"status": "done"}],
    )
    assert low["risk_level"] == "low", low

    print("risk_agent self-check passed:", high, low)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "--self-check":
        _demo()
    elif sys.argv[1] == "--all":
        print(run_for_all())
    else:
        print(run_for_case(sys.argv[1]))
