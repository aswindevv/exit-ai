"""Agent #5 -- Exit Checklist Generator (docs/agent_requirements.md #5).

"Takes employee role/department and auto-generates a personalized exit
checklist (assets to return, access to revoke, KT topics)." That is exactly
what hr_agent.generate_checklist already does -- this is a thin, individually
traced name for that capability, per blueprint1.md's mapping ("HR agent <-
#2, #5 checklist"). Does NOT reimplement or modify hr_agent.py.
"""
from __future__ import annotations

# hr_agent already has generate_checklist(); this module adds its own @traced_node
# wrapper so the step shows up separately in the terminal trace log.
from . import hr_agent
from ..core.trace import traced_node


@traced_node("Checklist Generator agent (#5)")
def generate(case_id: str, force: bool = False) -> dict:
    # Delegate entirely to hr_agent — no new logic here. force=True re-runs
    # even if tasks already exist (useful for testing; idempotency in hr_agent).
    return hr_agent.generate_checklist(case_id, force=force)
