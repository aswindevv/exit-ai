"""Agent #5 -- Exit Checklist Generator (agent_requirements.md #5).

"Takes employee role/department and auto-generates a personalized exit
checklist (assets to return, access to revoke, KT topics)." That is exactly
what hr_agent.generate_checklist already does -- this is a thin, individually
traced name for that capability, per blueprint1.md's mapping ("HR agent <-
#2, #5 checklist"). Does NOT reimplement or modify hr_agent.py.
"""
from __future__ import annotations

from . import hr_agent
from .trace import traced_node


@traced_node("Checklist Generator agent (#5)")
def generate(case_id: str, force: bool = False) -> dict:
    return hr_agent.generate_checklist(case_id, force=force)
