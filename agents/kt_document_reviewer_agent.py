"""Agent #10 -- KT Document Reviewer Agent (agent_requirements.md #10).

"Reviews Knowledge Transfer documents for completeness: checks if critical
topics are covered, identifies gaps, suggests additions based on role."
hr_agent.review_kt_document already does exactly this via an LLM review +
persisted gap task -- this is a thin, individually traced name for that
capability, per blueprint1.md's mapping ("HR agent <- #2, #5 checklist, #10
KT review, #16 doc collection"). Does NOT reimplement or modify hr_agent.py.
"""
from __future__ import annotations

from . import hr_agent
from .trace import traced_node


@traced_node("KT Document Reviewer agent (#10)")
def review(case_id: str, kt_text: str) -> dict:
    return hr_agent.review_kt_document(case_id, kt_text)
