"""Agent #7 -- Exit-Interview Intelligence.

Two modes, each its own compiled LangGraph subgraph. Neither needs branching
yet, so a small linear graph (analyze -> persist) is the right size -- not a
single function, because the blueprint's architecture is "every agent is a
compiled subgraph the supervisor can invoke as one node" (see Phase 6b).

  per_case      raw interview text -> summary/sentiment/themes/rehire fields,
                upserted onto that case's exit_interviews row.
  longitudinal  counts themes across every interview on file -> rising-theme
                rows on trend_alerts, deduped by (theme, department).

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.exit_intel_agent per-case <case_id> <path/to/transcript.txt>
    python -m agents.spokes.exit_intel_agent longitudinal
"""
from __future__ import annotations

import sys
from collections import Counter

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from ..core.config import db
from ..core.llm import ask_claude_json
from ..core.prompts import load_prompt
from ..core.trace import log_db, traced_node

SYSTEM_PROMPT = load_prompt("interview/summary_system.md")


# ---- per-case ---------------------------------------------------------

class PerCaseState(TypedDict):
    case_id: str
    interview_text: str
    result: dict


@traced_node("Exit-Interview Intelligence -- analyze")
def _analyze(state: PerCaseState) -> PerCaseState:
    state["result"] = ask_claude_json(SYSTEM_PROMPT, f"Transcript:\n{state['interview_text']}")
    return state


@traced_node("Exit-Interview Intelligence -- persist")
def _persist(state: PerCaseState) -> PerCaseState:
    r = state["result"]
    row = {
        "case_id": state["case_id"],
        "summary": r["summary"],
        "sentiment": r["sentiment"],
        "themes": r["themes"],
        "rehire_eligible": r["rehire_eligible"],
        "rehire_reason": r["rehire_reason"],
    }
    existing = db.table("exit_interviews").select("id").eq("case_id", state["case_id"]).execute()
    if existing.data:
        db.table("exit_interviews").update(row).eq("case_id", state["case_id"]).execute()
        log_db("update", "exit_interviews", rows=1)
    else:
        db.table("exit_interviews").insert(row).execute()
        log_db("insert", "exit_interviews", rows=1)
    return state


_per_case = StateGraph(PerCaseState)
_per_case.add_node("analyze", _analyze)
_per_case.add_node("persist", _persist)
_per_case.set_entry_point("analyze")
_per_case.add_edge("analyze", "persist")
_per_case.set_finish_point("persist")
per_case_graph = _per_case.compile()


def run_per_case(case_id: str, interview_text: str) -> dict:
    return per_case_graph.invoke({"case_id": case_id, "interview_text": interview_text, "result": {}})


# ---- longitudinal -------------------------------------------------------

# ponytail: naive frequency cutoff, no prior-period baseline yet -- "rising"
# just means "mentioned at least twice across all interviews on file".
# Upgrade: compare this period's theme counts against the prior period's.
RISING_THRESHOLD = 2


class LongitudinalState(TypedDict):
    rising: list[dict]


@traced_node("Exit-Interview Intelligence -- find rising themes")
def _find_rising_themes(state: LongitudinalState) -> LongitudinalState:
    interviews = db.table("exit_interviews").select("case_id, themes").execute().data or []
    case_ids = [i["case_id"] for i in interviews]
    dept_by_case: dict[str, str] = {}
    if case_ids:
        cases = db.table("exit_cases").select("id, department").in_("id", case_ids).execute().data or []
        dept_by_case = {c["id"]: c["department"] for c in cases}

    # Count each theme org-wide (not per-department) -- a theme repeated
    # across different departments is still a rising signal. Only tag the
    # alert with a specific department when every mention came from one.
    counts: Counter[str] = Counter()
    depts_by_theme: dict[str, set[str | None]] = {}
    for i in interviews:
        dept = dept_by_case.get(i["case_id"])
        for theme in i.get("themes") or []:
            counts[theme] += 1
            depts_by_theme.setdefault(theme, set()).add(dept)

    state["rising"] = [
        {
            "theme": theme,
            "department": next(iter(depts_by_theme[theme])) if len(depts_by_theme[theme]) == 1 else None,
            "count": n,
        }
        for theme, n in counts.items()
        if n >= RISING_THRESHOLD
    ]
    return state


def _severity(count: int) -> str:
    if count >= 4:
        return "high"
    if count >= 3:
        return "medium"
    return "low"


@traced_node("Exit-Interview Intelligence -- write trend alerts")
def _write_trend_alerts(state: LongitudinalState) -> LongitudinalState:
    inserted = 0
    for r in state["rising"]:
        query = db.table("trend_alerts").select("id").eq("theme", r["theme"])
        query = query.eq("department", r["department"]) if r["department"] else query.is_("department", "null")
        if query.execute().data:
            continue
        db.table("trend_alerts").insert({
            "theme": r["theme"],
            "department": r["department"],
            "severity": _severity(r["count"]),
            "detail": f"{r['count']} exit interviews mention this theme.",
        }).execute()
        inserted += 1
    log_db("insert", "trend_alerts", rows=inserted)
    return state


_longitudinal = StateGraph(LongitudinalState)
_longitudinal.add_node("find_rising", _find_rising_themes)
_longitudinal.add_node("write_alerts", _write_trend_alerts)
_longitudinal.set_entry_point("find_rising")
_longitudinal.add_edge("find_rising", "write_alerts")
_longitudinal.set_finish_point("write_alerts")
longitudinal_graph = _longitudinal.compile()


def run_longitudinal() -> dict:
    return longitudinal_graph.invoke({"rising": []})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "per-case":
        with open(sys.argv[3], encoding="utf-8") as f:
            text = f.read()
        print(run_per_case(sys.argv[2], text))
    elif sys.argv[1] == "longitudinal":
        print(run_longitudinal())
    else:
        print(__doc__)
        sys.exit(1)
