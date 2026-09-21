"""Phase 8 -- KT calendar booking.

Booking point mirrors Phase 7's email hook: hr_agent._persist_checklist
inserts the KT tasks (stage 'manager') and already sends a reminder email
there. This module books a Google Calendar event for the same tasks and
writes the event id back onto exit_tasks.kt_event_id (already in
0001_schema.sql -- the column was reserved for this phase).

Auth: a SINGLE shared demo Google account (aswindevv2005@gmail.com),
authorized ONCE via agents/oauth_setup.py against the existing "Exit Auth"
Google OAuth Web client -- not a service account, not per-user login. Every
KT event for every ExitAI user lands on that one account's calendar
(KT_CALENDAR_ID, default "primary"), with the employee + manager invited as
attendees by email. Production would use a service account or per-user
calendars instead of one shared reused refresh token.

Dev safety mirrors notifications.py: any of the three OAuth env vars unset ->
every booking is only logged, never raises.

Run (from repo root, with agents/.venv active):
    python -m agents.core.calendar_booking demo
"""
from __future__ import annotations

import sys
from datetime import date

from .config import (
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
    KT_CALENDAR_ID,
    db,
)
from .notifications import _profile_email
from .trace import log_db, traced_node

_SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
_TOKEN_URI = "https://oauth2.googleapis.com/token"


def _configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN)


def _service():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=None,
        refresh_token=GOOGLE_REFRESH_TOKEN,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        token_uri=_TOKEN_URI,
        scopes=_SCOPES,
    )
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


@traced_node("Calendar -- book KT event")
def _create_event(case: dict, task: dict) -> dict:
    if not _configured():
        print(f"[calendar:dev-log] would book KT event for {case['employee_name']}: "
              f"\"{task['title']}\" (due {task.get('due_date', 'soon')})")
        return {"booked": False, "logged": True}

    attendees = [e for e in (case.get("email"), _profile_email(case.get("manager_id"))) if e]
    day = task.get("due_date") or date.today().isoformat()
    event = {
        "summary": f"KT: {case['employee_name']} handover -- {task['title']}",
        "description": (
            f"Knowledge-transfer session for {case['employee_name']}'s exit "
            f"({case['role_title']}, {case['department']})."
        ),
        "start": {"date": day},
        "end": {"date": day},
        "attendees": [{"email": a} for a in attendees],
    }
    created = (
        _service().events()
        .insert(calendarId=KT_CALENDAR_ID, body=event, sendUpdates="all")
        .execute()
    )
    return {"booked": True, "event_id": created["id"]}


def book_kt_event(case: dict, task: dict) -> dict:
    """Books the event and, if it has a real id, persists it onto the task."""
    result = _create_event(case, task)
    if result.get("event_id") and task.get("id"):
        db.table("exit_tasks").update({"kt_event_id": result["event_id"]}).eq("id", task["id"]).execute()
        log_db("update", "exit_tasks", rows=1, detail="kt_event_id")
    return result


def _demo() -> None:
    """ponytail self-check: log-mode (no OAuth creds configured) never raises
    and never claims booked=True. Run: python -m agents.core.calendar_booking demo"""
    fake_case = {
        "employee_name": "Test Employee", "email": "test@example.com",
        "role_title": "Engineer", "department": "Eng", "manager_id": None,
    }
    fake_task = {"id": None, "title": "Handover session", "due_date": "2020-01-01"}
    r = book_kt_event(fake_case, fake_task)
    assert r == {"booked": False, "logged": True}, r
    print("calendar_booking self-check passed")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "demo":
        _demo()
    else:
        print(__doc__)
        sys.exit(1)
