"""Agent #2 -- HR agent.

Two compiled LangGraph subgraphs, same "generate -> persist" shape as the
Phase 6a agents:

  checklist   role_title/department -> a role-appropriate exit checklist,
              inserted as fresh exit_tasks rows (stage 'hr' + 'manager').
              Skips generation if the case already has hr/manager tasks, so
              re-running is idempotent instead of piling up duplicates.
  kt-review   an uploaded KT document's text -> completeness gaps. Split in
              two, because exit_tasks.title is shown verbatim to both the
              employee and the manager (see EmployeeDashboard.jsx /
              ManagerDashboard.jsx) -- there is no per-role phrasing field:
                - neutral, actionable exit_tasks rows (stage 'manager') for
                  each gap -- what the employee sees as a to-do.
                - the evaluative summary + gap list -> kt_reviews (HR/manager
                  only, never titled onto a task the employee can read).

No real KT-document upload exists yet (the "Knowledge transfer" nav item is
a static label -- checked EmployeeDashboard.jsx, ManagerDashboard.jsx). Same
stand-in as Phase 6a's interview transcripts: a local text file path.

Run (from repo root, with agents/.venv active):
    python -m agents.hr_agent checklist <case_id>
    python -m agents.hr_agent kt-review <case_id> <path/to/kt_doc.txt>
"""
from __future__ import annotations

import re
import sys
from datetime import date, timedelta

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import email_drafting_agent
from .calendar_booking import book_kt_event
from .config import db
from .llm import ask_claude_json
from .trace import log_db, traced_node

CHECKLIST_SYSTEM_PROMPT = (
    "You generate an offboarding checklist for an exiting employee. Return "
    "ONLY a JSON object with keys 'hr_tasks' and 'manager_tasks', each a list "
    "of 2-4 short imperative task titles tailored to the employee's role and "
    "department. Titles must be neutral and actionable (things to do), never "
    "evaluative -- they are shown to the employee as their own to-do list. "
    "'manager_tasks' are KNOWLEDGE-TRANSFER and handover items only: "
    "documenting, transferring ownership, briefing the team, handing off "
    "contacts, scheduling a handover session. Never put IT deprovisioning "
    "(revoking or disabling access, accounts, SSO, credentials, repository "
    "permissions; collecting laptops, devices or access cards) or finance "
    "settlement work in 'manager_tasks' -- separate IT and Finance agents own "
    "those stages and generate their own plans."
)

# The prompt above tells the model the rule; this enforces it. The checklist
# LLM used to write IT deprovisioning work into 'manager_tasks' (e.g. "Revoke
# access to internal systems, servers, and repositories"), which landed on the
# manager's KT approvals queue as an item the manager cannot do and IT never
# sees -- and, because agents/service.py's manager_approve requires EVERY
# manager-stage row to be done, held the manager->IT gate shut on it.
#
# Matched titles are DROPPED, not re-staged to 'it' here: inserting a
# stage='it' row at checklist time would make it_agent.generate_plan's "it
# tasks already exist" idempotency check skip the real deprovisioning plan at
# the manager gate. Nothing is lost -- the IT agent generates these properly,
# in IT's own queue, when the gate opens.
#
# Deliberately anchored on the leading verb so genuine KT items survive:
# "Share access credentials for analytics tools" and "Transfer access to
# marketing platforms" are handover work and are kept; "Revoke access to ..."
# and "Collect company laptop" are not.
IT_OWNED_TITLE_RE = re.compile(
    r"^\s*(?:revoke|de-?provision|disable|deactivate|terminate|remove)\b[^.]*?\b"
    r"(?:access|account|credential|login|sso|permission|licen[cs]e|key)s?\b"
    r"|^\s*(?:collect|retrieve|recover|reclaim)\b[^.]*?\b"
    r"(?:laptop|macbook|device|hardware|equipment|peripheral|headset|badge|access card)s?\b",
    re.IGNORECASE,
)

KT_REVIEW_SYSTEM_PROMPT = (
    "You review a knowledge-transfer handover document for completeness "
    "ahead of an employee's exit. Return ONLY a JSON object with keys: "
    "complete (boolean), gaps (a list of {topic, detail} objects, empty if "
    "none), summary (2-3 sentences for the employee's manager, evaluative "
    "framing is fine here)."
)


# ---- checklist ----------------------------------------------------------

class ChecklistState(TypedDict):
    case_id: str
    case: dict
    result: dict


@traced_node("HR agent -- generate checklist")
def _generate_checklist(state: ChecklistState) -> ChecklistState:
    case = state["case"]
    user = f"Role: {case['role_title']}\nDepartment: {case['department']}"
    state["result"] = ask_claude_json(CHECKLIST_SYSTEM_PROMPT, user)
    return state


@traced_node("HR agent -- persist checklist")
def _persist_checklist(state: ChecklistState) -> ChecklistState:
    case_id = state["case_id"]
    last_day = date.fromisoformat(state["case"]["last_working_day"])
    r = state["result"]
    hr_rows = [
        {"case_id": case_id, "stage": "hr", "title": t, "status": "pending",
         "due_date": (last_day - timedelta(days=3)).isoformat()}
        for t in r.get("hr_tasks", [])
    ]
    kt_titles, it_owned = [], []
    for t in r.get("manager_tasks", []):
        (it_owned if IT_OWNED_TITLE_RE.search(t or "") else kt_titles).append(t)
    if it_owned:
        log_db("drop", "exit_tasks", rows=len(it_owned),
               detail=f"IT-owned titles kept out of stage=manager: {it_owned}")
    manager_rows = [
        {"case_id": case_id, "stage": "manager", "title": t, "status": "pending",
         "due_date": (last_day - timedelta(days=1)).isoformat()}
        for t in kt_titles
    ]
    rows = hr_rows + manager_rows
    inserted_manager_rows = []
    if rows:
        inserted = db.table("exit_tasks").insert(rows).execute().data or []
        inserted_manager_rows = [r for r in inserted if r["stage"] == "manager"]
    log_db("insert", "exit_tasks", rows=len(rows))

    # KT scheduled: manager_rows are the KT tasks (ManagerDashboard.jsx's
    # ktTasks = stage 'manager'). Remind employee + manager now that they
    # have a due_date, and book a calendar event per task (Phase 8).
    if manager_rows:
        email_drafting_agent.kt_reminder(state["case"], manager_rows)
    for t in inserted_manager_rows:
        book_kt_event(state["case"], t)
    return state


_checklist = StateGraph(ChecklistState)
_checklist.add_node("generate", _generate_checklist)
_checklist.add_node("persist", _persist_checklist)
_checklist.set_entry_point("generate")
_checklist.add_edge("generate", "persist")
_checklist.set_finish_point("persist")
checklist_graph = _checklist.compile()


def generate_checklist(case_id: str, force: bool = False) -> dict:
    """Idempotent unless force=True: skips if hr/manager tasks already exist
    for this case (seeded or already agent-generated)."""
    if not force:
        existing = (
            db.table("exit_tasks").select("id").eq("case_id", case_id).in_("stage", ["hr", "manager"]).execute().data
        )
        if existing:
            return {"skipped": True, "reason": "hr/manager tasks already exist"}
    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    return checklist_graph.invoke({"case_id": case_id, "case": case, "result": {}})


# ---- KT review ------------------------------------------------------------

class KtReviewState(TypedDict):
    case_id: str
    kt_text: str
    result: dict


@traced_node("HR agent -- review KT document")
def _review_kt(state: KtReviewState) -> KtReviewState:
    state["result"] = ask_claude_json(KT_REVIEW_SYSTEM_PROMPT, f"Handover document:\n{state['kt_text']}")
    return state


@traced_node("HR agent -- persist KT review")
def _persist_kt_review(state: KtReviewState) -> KtReviewState:
    case_id = state["case_id"]
    r = state["result"]
    gaps = r.get("gaps", [])

    # Idempotent per gap topic: a case can be KT-reviewed repeatedly (re-run,
    # resubmitted handover), and re-inserting an identical title would stack
    # duplicate to-dos on the manager's card.
    existing = {
        t["title"]
        for t in (
            db.table("exit_tasks")
            .select("title")
            .eq("case_id", case_id)
            .eq("stage", "manager")
            .execute()
            .data
            or []
        )
    }
    task_rows = [
        {"case_id": case_id, "stage": "manager", "status": "pending", "title": title}
        for title in (f"Add handover notes: {g['topic']}" for g in gaps)
        if title not in existing
    ]
    if task_rows:
        db.table("exit_tasks").insert(task_rows).execute()
    log_db("insert", "exit_tasks", rows=len(task_rows))

    db.table("kt_reviews").insert({
        "case_id": case_id,
        "summary": r["summary"],
        "gaps": gaps,
        "complete": r.get("complete", not gaps),
    }).execute()
    log_db("insert", "kt_reviews", rows=1)
    return state


_kt_review = StateGraph(KtReviewState)
_kt_review.add_node("review", _review_kt)
_kt_review.add_node("persist", _persist_kt_review)
_kt_review.set_entry_point("review")
_kt_review.add_edge("review", "persist")
_kt_review.set_finish_point("persist")
kt_review_graph = _kt_review.compile()


def review_kt_document(case_id: str, kt_text: str) -> dict:
    return kt_review_graph.invoke({"case_id": case_id, "kt_text": kt_text, "result": {}})


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "checklist":
        print(generate_checklist(sys.argv[2]))
    elif sys.argv[1] == "kt-review":
        with open(sys.argv[3], encoding="utf-8") as f:
            text = f.read()
        print(review_kt_document(sys.argv[2], text))
    else:
        print(__doc__)
        sys.exit(1)
