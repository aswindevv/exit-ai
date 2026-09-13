"""Agent #21 -- Intelligent Rehire Assessment (agent_requirements.md #21 / blueprint1.md #21).

"Eligibility from performance + sentiment + manager feedback." risk_agent.score()
already computes rehire_eligible (from exit_interviews.rehire_eligible, falling back
to risk_level != "high") and persists it onto exit_cases -- this is a thin,
individually traced wrapper for that capability, per blueprint1.md's mapping ("REUSE
risk rehire field, own module"). Does NOT reimplement or modify risk_agent.py. The
rationale is whatever exit_intel_agent already wrote to exit_interviews.rehire_reason.

Run (from repo root, with agents/.venv active):
    python -m agents.rehire_agent <case_id>
"""
from __future__ import annotations

import sys

from . import risk_agent
from .config import db
from .trace import traced_node


@traced_node("Intelligent Rehire Assessment agent (#21)")
def assess(case_id: str) -> dict:
    result = risk_agent.run_for_case(case_id)["result"]
    interview = db.table("exit_interviews").select("rehire_reason").eq("case_id", case_id).execute().data
    return {
        "rehire_eligible": result["rehire_eligible"],
        "rehire_reason": interview[0]["rehire_reason"] if interview else None,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    print(assess(sys.argv[1]))
