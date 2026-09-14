"""Agent #5 -- Notification agent.

Templated stage emails, one sender account (GMAIL_ADDRESS / GMAIL_APP_PASSWORD),
sent via smtplib over Gmail's SMTP -- the stdlib equivalent of the denomailer
SMTPClient already used by supabase/functions/forward-to-hr/index.ts against
the same account. No LLM: like the Finance agent, this is a templated tool
call, not a reasoning agent.

Four templates / trigger points (blueprint Phase 7 + F/G resignation gate):
  resignation notice     -- employee submits their resignation (agents.service
                             .activate_case, triggered by the frontend right
                             after submit-resignation/index.ts creates the case)
  KT reminder            -- hr_agent persists a KT task (stage 'manager', the
                             same rows ManagerDashboard.jsx filters as ktTasks)
  overdue warning        -- check_overdue_and_notify(): any pending task past
                             its due_date, run manually/on a schedule like
                             analytics_agent.run()
  completion notice      -- finance_agent flips the clearance task from
                             pending to done

Dev safety: EMAIL_TEST_RECIPIENT unset -> every send is only logged to the
terminal (no network call). Set (to any value) -> real sends go out over
Gmail SMTP, always From GMAIL_ADDRESS (aswindevv2005@gmail.com), always To
the actual intended recipient's own address -- the employee's mail for KT/
overdue/completion, the manager's mail for the resignation notice, HR's mail
for the completion notice. No redirect to a single inbox.

Run (from repo root, with agents/.venv active):
    python -m agents.notifications check-overdue
"""
from __future__ import annotations

import smtplib
import sys
from datetime import date
from email.mime.text import MIMEText

from .config import EMAIL_TEST_RECIPIENT, GMAIL_ADDRESS, GMAIL_APP_PASSWORD, db
from .trace import log_db, traced_node

# Shared identity + template for every outgoing email -- one look across all
# four trigger points instead of each hand-formatting its own body.
SENDER_DISPLAY = "ExitAI (Perficient)"
SIGNOFF = ("Regards,", "The ExitAI Team", "Perficient")


def _compose(to_name: str | None, intro: str, lines: list[str] = (), closing: str = "") -> str:
    greeting = f"Hi {to_name}," if to_name else "Hi there,"
    parts = [greeting, "", intro]
    if lines:
        parts += [""] + [f"  - {l}" for l in lines]
    if closing:
        parts += ["", closing]
    parts += ["", *SIGNOFF]
    return "\n".join(parts)


@traced_node("Notification agent -- send email")
def _send(to: str, subject: str, body: str) -> dict:
    if not EMAIL_TEST_RECIPIENT:
        print(f"[email:dev-log] to={to}\nsubject={subject}\n{body}\n")
        return {"sent": False, "logged": True, "to": to}

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = f"{SENDER_DISPLAY} <{GMAIL_ADDRESS}>"
    msg["To"] = to
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        smtp.sendmail(GMAIL_ADDRESS, [to], msg.as_string())
    return {"sent": True, "to": to}


def _profile_email(profile_id: str | None) -> str | None:
    if not profile_id:
        return None
    row = db.table("profiles").select("email").eq("id", profile_id).single().execute().data
    return row["email"] if row else None


def _profile_name(profile_id: str | None) -> str | None:
    if not profile_id:
        return None
    row = db.table("profiles").select("full_name").eq("id", profile_id).single().execute().data
    return row["full_name"] if row else None


def send_kt_reminder(case: dict, tasks: list[dict]) -> dict:
    subject = f"KT reminder: {case['employee_name']}'s handover"
    intro = (
        f"The following knowledge-transfer items are due ahead of "
        f"{case['employee_name']}'s exit ({case['role_title']}, {case['department']}):"
    )
    lines = [f"{t['title']} (due {t.get('due_date', 'soon')})" for t in tasks]
    closing = "Please complete these items before the due date."
    manager_id = case.get("manager_id")
    recipients = [
        (case["email"], case["employee_name"]),
        (_profile_email(manager_id), _profile_name(manager_id)),
    ]
    results = [
        _send(to, subject, _compose(name, intro, lines, closing))
        for to, name in recipients if to
    ]
    log_db("send", "notifications", rows=len(results), detail="kt_reminder")
    return {"results": results}


def send_overdue_warning(case: dict, task: dict) -> dict:
    subject = f"Overdue: \"{task['title']}\" ({case['employee_name']})"
    intro = f"The following exit task was due {task['due_date']} and is still pending:"
    lines = [f"{task['title']} (stage: {task['stage']})"]
    closing = "Please complete this as soon as possible."
    body = _compose(case.get("employee_name"), intro, lines, closing)
    result = _send(case["email"], subject, body)
    log_db("send", "notifications", rows=1, detail="overdue_warning")
    return result


def send_resignation_notice(case: dict) -> dict:
    subject = f"Resignation submitted: {case['employee_name']}"
    intro = (
        f"{case['employee_name']} ({case['role_title']}, {case['department']}) has "
        f"submitted their resignation."
    )
    lines = [f"Last working day: {case['last_working_day']}"]
    closing = "Please review their exit case in the ExitAI manager dashboard."
    manager_id = case.get("manager_id")
    to = _profile_email(manager_id)
    body = _compose(_profile_name(manager_id), intro, lines, closing)
    result = _send(to, subject, body) if to else {"sent": False, "logged": False, "to": None}
    log_db("send", "notifications", rows=1 if to else 0, detail="resignation_notice")
    return result


def send_completion_notice(case: dict) -> dict:
    subject = f"Clearance complete: {case['employee_name']}"
    intro = (
        f"All financial clearance items are complete for {case['employee_name']}'s "
        f"exit ({case['role_title']}, {case['department']})."
    )
    closing = "No further action is needed."
    hr_id = case.get("hr_id")
    recipients = [
        (case["email"], case["employee_name"]),
        (_profile_email(hr_id), _profile_name(hr_id)),
    ]
    results = [
        _send(to, subject, _compose(name, intro, [], closing))
        for to, name in recipients if to
    ]
    log_db("send", "notifications", rows=len(results), detail="completion_notice")
    return {"results": results}


def send_relieving_letter_notice(case: dict) -> dict:
    subject = f"Relieving letter issued: {case['employee_name']}"
    intro = (
        f"HR has issued the relieving letter for {case['employee_name']}'s exit "
        f"({case['role_title']}, {case['department']}). The exit case is now closed."
    )
    body = _compose(case.get("employee_name"), intro, [], "")
    result = _send(case["email"], subject, body) if case.get("email") else {"sent": False, "logged": False, "to": None}
    log_db("send", "notifications", rows=1 if case.get("email") else 0, detail="relieving_letter_notice")
    return result


def check_overdue_and_notify() -> dict:
    """Scans every pending task past its due_date and sends one warning each.
    Run manually/on a schedule -- same posture as analytics_agent.run(), no
    live cron exists in this demo either."""
    today = date.today().isoformat()
    overdue = (
        db.table("exit_tasks").select("id, case_id, stage, title, due_date, status")
        .eq("status", "pending").lt("due_date", today).execute().data or []
    )
    notified = 0
    for t in overdue:
        case = db.table("exit_cases").select("*").eq("id", t["case_id"]).single().execute().data
        if case:
            send_overdue_warning(case, t)
            notified += 1
    return {"overdue_count": len(overdue), "notified": notified}


def _demo() -> None:
    """ponytail self-check: _compose produces a greeted, structured, signed-off
    body -- independent of EMAIL_TEST_RECIPIENT (that's an env/send concern,
    not a formatting one). Run: python -m agents.notifications demo"""
    body = _compose("Test Employee", "This is the intro.", ["Item one", "Item two"], "Please act.")
    assert body.startswith("Hi Test Employee,\n\n"), body
    assert "  - Item one" in body and "  - Item two" in body, body
    assert body.endswith("Regards,\nThe ExitAI Team\nPerficient"), body
    no_name = _compose(None, "Intro.", [], "")
    assert no_name.startswith("Hi there,\n\n"), no_name
    print("notifications self-check passed")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "check-overdue":
        print(check_overdue_and_notify())
    elif len(sys.argv) > 1 and sys.argv[1] == "demo":
        _demo()
    else:
        print(__doc__)
        sys.exit(1)
