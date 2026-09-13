"""Agent #18 -- Automated IT Deprovisioning (agent_requirements.md #18).

"Generates and executes IT deprovisioning plans (list accounts to disable,
access to revoke, data to archive) with human-in-the-loop approval." That is
exactly what it_agent.generate_plan already does -- this is a thin,
individually traced name for that capability, per blueprint1.md's mapping
("IT agent <- #3, #18 deprovisioning"). Does NOT reimplement or modify
it_agent.py. "Human-in-the-loop approval" is the same posture it_agent
already has: tasks are persisted as pending, never auto-executed.
"""
from __future__ import annotations

from . import it_agent
from .trace import traced_node


@traced_node("Automated IT Deprovisioning agent (#18)")
def generate(case_id: str, force: bool = False) -> dict:
    return it_agent.generate_plan(case_id, force=force)
