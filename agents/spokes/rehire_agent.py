"""Agent #21 -- Intelligent Rehire Assessment (docs/agent_requirements.md #21 / blueprint1.md #21).

"Eligibility from performance + sentiment + manager feedback." risk_agent.score()
already computes rehire_eligible (from exit_interviews.rehire_eligible, falling back
to risk_level != "high") and persists it onto exit_cases -- this is a thin,
individually traced wrapper for that capability, per blueprint1.md's mapping ("REUSE
risk rehire field, own module"). Does NOT reimplement or modify risk_agent.py. The
rationale is whatever exit_intel_agent already wrote to exit_interviews.rehire_reason.

Adds the plan-required confidence/evidence on top of risk_agent's bare eligibility
flag, and gives the assessment its own independent execution record (an agent_runs
row, the same reused pattern as email_drafting_agent/sla_escalation/doc_collection)
so it doesn't just appear as a side effect of risk_agent's exit_cases write.

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.rehire_agent <case_id>
"""
from __future__ import annotations

import sys

# risk_agent.run_for_case() already writes rehire_eligible to exit_cases.
# This module adds its own execution record and enriches the result with
# a confidence level and evidence list — without duplicating risk_agent logic.
from . import risk_agent
from ..core.config import db
from ..core.trace import log_db, traced_node


def _assess(rehire_eligible: bool, risk_level: str, rehire_reason: str | None) -> dict:
    """Pure function: real inputs in -> eligibility/confidence/evidence out.
    Confidence is deterministic, not guessed: "high" when an actual interview
    rationale exists to back the eligibility flag, else "medium" (eligibility
    alone, from risk_agent's risk_level fallback)."""
    evidence = [f"risk_agent.risk_level={risk_level}"]
    if rehire_reason:
        evidence.append("exit_interviews.rehire_reason")
    return {
        "rehire_eligible": rehire_eligible,
        "rehire_reason": rehire_reason,
        "confidence": "high" if rehire_reason else "medium",
        "evidence": evidence,
    }


@traced_node("Intelligent Rehire Assessment agent (#21)")
def assess(case_id: str) -> dict:
    result = risk_agent.run_for_case(case_id)["result"]
    interview = db.table("exit_interviews").select("rehire_reason").eq("case_id", case_id).execute().data
    rehire_reason = interview[0]["rehire_reason"] if interview else None
    assessment = _assess(result["rehire_eligible"], result["risk_level"], rehire_reason)
    db.table("agent_runs").insert({
        "case_id": case_id,
        "stage": "rehire_assessment",
        "agent": "rehire_agent",
        "status": "done",
        "detail": f"rehire_eligible={assessment['rehire_eligible']} confidence={assessment['confidence']}",
        "metadata": assessment,
    }).execute()
    log_db("insert", "agent_runs", rows=1, detail="rehire_assessment")
    return assessment


def _demo() -> None:
    """Pure-logic self-check, no network -- run with --self-check."""
    with_reason = _assess(True, "low", "Strong performer, left for relocation only.")
    assert with_reason["confidence"] == "high" and "exit_interviews.rehire_reason" in with_reason["evidence"], with_reason

    without_reason = _assess(False, "high", None)
    assert without_reason["confidence"] == "medium" and without_reason["evidence"] == ["risk_agent.risk_level=high"], without_reason

    print("rehire_agent self-check passed:", with_reason, without_reason)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "--self-check":
        _demo()
    else:
        print(assess(sys.argv[1]))
