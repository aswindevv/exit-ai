"""Agent #23 -- Predictive Attrition (docs/agent_requirements.md #23 / blueprint1.md #23).

NEW. "A multi-agent pipeline: a Data Collector gathers signals, an Analyzer identifies
at-risk employees, a Recommendation Agent suggests retention interventions on
scheduled triggers." Realized as a three-node compiled subgraph (gather -> identify ->
narrate+persist), same "every agent is a subgraph" shape as the rest of Phase 5/6.
"""
from __future__ import annotations

import sys
from collections import defaultdict

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from ..core.config import db
from ..core.llm import ask_claude
from ..core.prompts import load_prompt
from ..core.trace import log_db, traced_node

# ponytail: no engagement-survey/current-employee-sentiment data exists anywhere in
# the schema (checked profiles, exit_cases, exit_interviews, trend_alerts) -- there is
# no per-employee attrition signal to score directly. Proxying at "which department"
# risk from two things that DO exist for real: (1) departments whose already-departed
# cases carry a high average risk_score, (2) departments named in trend_alerts with
# medium/high severity (recurring negative exit-interview themes). Current employees
# (profiles.role='employee') in a flagged department are the "at-risk" group -- a
# department-level proxy for individual risk. Upgrade: score individuals directly
# once real engagement/manager-feedback data exists per active employee.
HIGH_RISK_AVG = 0.6

SYSTEM_PROMPT = load_prompt("analytics/attrition_system.md")


def identify_at_risk(cases: list[dict], alerts: list[dict], employees: list[dict]) -> dict:
    """Pure function: real signals in -> flagged departments + their current
    employees out. See module docstring for what each signal proxies."""
    scores_by_dept: dict[str, list[float]] = defaultdict(list)
    for c in cases:
        if c.get("department") and c.get("risk_score") is not None:
            scores_by_dept[c["department"]].append(c["risk_score"])
    high_risk_depts = {
        d for d, scores in scores_by_dept.items() if sum(scores) / len(scores) >= HIGH_RISK_AVG
    }
    alert_depts = {a["department"] for a in alerts if a.get("department") and a.get("severity") != "low"}

    signals: dict[str, list[str]] = defaultdict(list)
    for d in high_risk_depts:
        avg = round(sum(scores_by_dept[d]) / len(scores_by_dept[d]), 2)
        signals[d].append(f"avg exit risk_score {avg}")
    for a in alerts:
        if a.get("department") and a.get("severity") != "low":
            signals[a["department"]].append(f"trend alert: {a['theme']} ({a['severity']})")

    at_risk_depts = sorted(signals)
    at_risk_employees = [e for e in employees if e.get("department") in signals]
    return {
        "at_risk_departments": [{"department": d, "signals": signals[d]} for d in at_risk_depts],
        "at_risk_employee_count": len(at_risk_employees),
    }


class AttritionState(TypedDict):
    cases: list[dict]
    alerts: list[dict]
    employees: list[dict]
    signals: dict
    narrative: str


@traced_node("Predictive Attrition -- gather signals")
def _gather(state: AttritionState) -> AttritionState:
    state["cases"] = db.table("exit_cases").select("department, risk_score").execute().data or []
    state["alerts"] = db.table("trend_alerts").select("department, severity, theme").execute().data or []
    state["employees"] = (
        db.table("profiles").select("employee_id, full_name, department").eq("role", "employee").execute().data or []
    )
    return state


@traced_node("Predictive Attrition -- identify at-risk")
def _identify(state: AttritionState) -> AttritionState:
    state["signals"] = identify_at_risk(state["cases"], state["alerts"], state["employees"])
    return state


@traced_node("Predictive Attrition -- narrate & persist")
def _narrate_and_persist(state: AttritionState) -> AttritionState:
    signals = state["signals"]
    if signals["at_risk_departments"]:
        state["narrative"] = ask_claude(SYSTEM_PROMPT, f"At-risk departments:\n{signals['at_risk_departments']}")
    else:
        state["narrative"] = "No department currently shows a rising attrition signal."
    db.table("analytics_insights").insert({
        "narrative": state["narrative"],
        "stats": signals,
        "agent_type": "predictive_attrition",
    }).execute()
    log_db("insert", "analytics_insights", rows=1)
    return state


_graph = StateGraph(AttritionState)
_graph.add_node("gather", _gather)
_graph.add_node("identify", _identify)
_graph.add_node("narrate_persist", _narrate_and_persist)
_graph.set_entry_point("gather")
_graph.add_edge("gather", "identify")
_graph.add_edge("identify", "narrate_persist")
_graph.set_finish_point("narrate_persist")
attrition_graph = _graph.compile()


def run() -> dict:
    return attrition_graph.invoke({"cases": [], "alerts": [], "employees": [], "signals": {}, "narrative": ""})


def _demo() -> None:
    """Pure-arithmetic self-check, no network -- run with --self-check."""
    flagged = identify_at_risk(
        cases=[{"department": "Engineering", "risk_score": 0.8}, {"department": "Engineering", "risk_score": 0.7},
               {"department": "Support", "risk_score": 0.2}],
        alerts=[{"department": "Sales", "severity": "high", "theme": "compensation"}],
        employees=[{"employee_id": "E1", "full_name": "A", "department": "Engineering"},
                   {"employee_id": "E2", "full_name": "B", "department": "Support"},
                   {"employee_id": "E3", "full_name": "C", "department": "Sales"}],
    )
    depts = {d["department"] for d in flagged["at_risk_departments"]}
    assert depts == {"Engineering", "Sales"}, flagged
    assert flagged["at_risk_employee_count"] == 2, flagged

    clear = identify_at_risk(
        cases=[{"department": "Support", "risk_score": 0.2}],
        alerts=[{"department": "Support", "severity": "low", "theme": "workload"}],
        employees=[{"employee_id": "E1", "full_name": "A", "department": "Support"}],
    )
    assert clear["at_risk_departments"] == [] and clear["at_risk_employee_count"] == 0, clear

    print("attrition_agent self-check passed:", flagged, clear)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    else:
        print(run())
