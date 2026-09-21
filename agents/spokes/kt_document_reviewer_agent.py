"""Agent #10 -- KT Document Reviewer Agent (docs/agent_requirements.md #10).

"Reviews Knowledge Transfer documents for completeness: checks if critical
topics are covered, identifies gaps, suggests additions based on role."
hr_agent.review_kt_document already does exactly this via an LLM review +
persisted gap task -- this is a thin, individually traced name for that
capability, per blueprint1.md's mapping ("HR agent <- #2, #5 checklist, #10
KT review, #16 doc collection"). Does NOT reimplement or modify hr_agent.py.
"""
from __future__ import annotations

# hr_agent already has review_kt_document(); this module adds its own @traced_node
# wrapper so the step appears separately in the terminal trace log.
from . import hr_agent
from ..core.trace import traced_node


@traced_node("KT Document Reviewer agent (#10)")
def review(case_id: str, kt_text: str) -> dict:
    # Delegate entirely to hr_agent — no new logic here.
    # kt_text is the raw handover document text the employee submitted.
    return hr_agent.review_kt_document(case_id, kt_text)
