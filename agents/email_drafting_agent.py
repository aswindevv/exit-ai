"""Agent #6 -- Email Drafting Agent (agent_requirements.md #6).

"Drafts stage-specific notification emails (KT reminder, overdue warning,
completion) using LLM prompts with structured templates." notifications.py
already composes (_compose) and sends all three -- this is a thin,
individually traced name for that capability, per blueprint1.md's mapping
("Notification agent <- #6 email drafting, #9 SLA escalation"). Does NOT
reimplement or modify notifications.py.
"""
from __future__ import annotations

from . import notifications
from .trace import traced_node


@traced_node("Email Drafting agent (#6) -- KT reminder")
def kt_reminder(case: dict, tasks: list[dict]) -> dict:
    return notifications.send_kt_reminder(case, tasks)


@traced_node("Email Drafting agent (#6) -- overdue warning")
def overdue_warning(case: dict, task: dict) -> dict:
    return notifications.send_overdue_warning(case, task)


@traced_node("Email Drafting agent (#6) -- completion notice")
def completion_notice(case: dict) -> dict:
    return notifications.send_completion_notice(case)
