"""Agent #6 -- Email Drafting Agent (docs/agent_requirements.md #6).

"Drafts stage-specific notification emails ... using LLM prompts with
structured templates." notifications.py already composes (_compose) and
sends every template -- this is the single real routing point for every
email-producing workflow (KT reminder, overdue warning, resignation notice,
completion notice, relieving letter notice, SLA escalation, doc-collection
reminder): every one of those call sites now goes through here instead of
calling notifications.py directly, and every call is recorded to agent_runs
with real generation/send metadata (never a fabricated inbox-delivery claim
-- status is one of smtp_accepted/dev_logged/failed, matching
notifications._send's own sent/logged split). Does NOT reimplement or modify
notifications.py's compose/send logic.
"""
from __future__ import annotations

import sys

from ..core import notifications
from ..core.config import db
from ..core.trace import log_db, traced_node


def _outcomes(result: dict) -> list[dict]:
    return result["results"] if "results" in result else [result]


def _status(outcomes: list[dict]) -> str:
    if any(o.get("sent") for o in outcomes):
        return "smtp_accepted"
    if any(o.get("logged") for o in outcomes):
        return "dev_logged"
    return "failed"


def _record_email(case_id: str | None, template: str, result: dict | None, error: str | None = None) -> None:
    if not case_id:
        return
    outcomes = _outcomes(result) if result is not None else []
    status = "failed" if error else _status(outcomes)
    metadata = {
        "template": template,
        "recipients": [o.get("to") for o in outcomes if o.get("to")],
        "outcomes": outcomes,
    }
    if error:
        metadata["error"] = error
    db.table("agent_runs").insert({
        "case_id": case_id,
        "stage": "email_drafting",
        "agent": "email_drafting_agent",
        "status": status,
        "detail": f"{template} -> {status}",
        "metadata": metadata,
    }).execute()
    log_db("insert", "agent_runs", rows=1, detail=f"email_drafting:{template}:{status}")


def _drafted(template: str, case_id: str | None, fn, *args, **kwargs) -> dict:
    """Never lets a send failure propagate: a real SMTP/network error here
    must not abort the rest of whatever pipeline called us (e.g. finance_agent's
    caller still needs to run the risk/assess stage; sla_escalation's caller
    still needs to notify the *other* breaches in this batch). The failure is
    still fully recorded to agent_runs -- this only stops the exception, not
    the audit trail (Phase 5 Scenario E: 'workflow state remains consistent')."""
    try:
        result = fn(*args, **kwargs)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        _record_email(case_id, template, None, error=error)
        return {"sent": False, "logged": False, "to": None, "error": error}
    _record_email(case_id, template, result)
    return result


@traced_node("Email Drafting agent (#6) -- KT reminder")
def kt_reminder(case: dict, tasks: list[dict]) -> dict:
    return _drafted("kt_reminder", case.get("id"), notifications.send_kt_reminder, case, tasks)


@traced_node("Email Drafting agent (#6) -- overdue warning")
def overdue_warning(case: dict, task: dict) -> dict:
    return _drafted("overdue_warning", case.get("id"), notifications.send_overdue_warning, case, task)


@traced_node("Email Drafting agent (#6) -- resignation notice")
def resignation_notice(case: dict) -> dict:
    return _drafted("resignation_notice", case.get("id"), notifications.send_resignation_notice, case)


@traced_node("Email Drafting agent (#6) -- completion notice")
def completion_notice(case: dict) -> dict:
    return _drafted("completion_notice", case.get("id"), notifications.send_completion_notice, case)


@traced_node("Email Drafting agent (#6) -- relieving letter notice")
def relieving_letter_notice(case: dict) -> dict:
    return _drafted("relieving_letter_notice", case.get("id"), notifications.send_relieving_letter_notice, case)


@traced_node("Email Drafting agent (#6) -- SLA escalation")
def escalation_notice(breach: dict) -> dict:
    return _drafted("escalation_notice", breach.get("case_id"), notifications.send_escalation_notice, breach)


@traced_node("Email Drafting agent (#6) -- document reminder")
def doc_reminder(case: dict, missing: list[str]) -> dict:
    return _drafted("doc_reminder", case.get("id"), notifications.send_doc_reminder, case, missing)


def _demo() -> None:
    """Pure-arithmetic self-check, no network/DB -- run with --self-check.
    Mirrors notifications._send's own sent/logged/neither outcomes -- never
    claims inbox delivery, only generation/send-attempt status."""
    assert _status(_outcomes({"sent": True, "to": "a@b.com"})) == "smtp_accepted"
    assert _status(_outcomes({"sent": False, "logged": True, "to": None})) == "dev_logged"
    assert _status(_outcomes({"sent": False, "logged": False, "to": None})) == "failed"
    multi = _outcomes({"results": [{"sent": False, "logged": True, "to": "x"}, {"sent": True, "to": "y"}]})
    assert _status(multi) == "smtp_accepted", multi

    def _boom(*_a, **_kw):
        raise RuntimeError("simulated SMTP outage")
    # case_id=None short-circuits _record_email's DB write, so this exercises
    # the swallow-not-raise path with no network/DB needed.
    caught = _drafted("test_template", None, _boom)
    assert caught == {"sent": False, "logged": False, "to": None, "error": "RuntimeError: simulated SMTP outage"}, caught

    print("email_drafting_agent self-check passed")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    else:
        print(__doc__)
        sys.exit(1)
