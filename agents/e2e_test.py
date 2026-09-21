"""Phase 9 -- end-to-end integration test.

Runs one exit case through the full pipeline this project builds: create a
case for a seed employee who doesn't have one yet -> supervisor (HR checklist
+ KT review + IT deprovisioning plan + finance check + interview intelligence
+ risk scoring, with a real KT-reminder email log and a real Google Calendar
booking if GOOGLE_REFRESH_TOKEN is configured) -> employee/manager/IT
complete their tasks -> finance re-checked -> clearance completes (fires the
completion-notice email) -> re-query the exact tables/columns each dashboard
reads for this case to prove the data is live, not placeholder.

Picks whichever seeded employee has no exit_cases row yet, so it's
re-runnable against a fresh case each time without touching Phase 2's demo
cases. role_title is derived by reverse-mapping department -> title through
the same (department, role_title) pairs scripts/seed/seed.js used -- profiles
itself has no role_title column.

Run (from repo root, with agents/.venv active):
    python -m agents.e2e_test
"""
from __future__ import annotations

from datetime import date, timedelta

from .core.config import db
from .spokes.finance_agent import check_clearance
from .hub.supervisor import run_case

DEPARTMENT_TITLES = {
    "Engineering": "Software Engineer",
    "Sales": "Sales Executive",
    "Marketing": "Marketing Specialist",
    "Finance": "Financial Analyst",
    "Support": "Support Engineer",
    "Product": "Product Analyst",
    "Operations": "Operations Coordinator",
    "HR": "HR Generalist",
}

KT_TEXT = (
    "Handover doc: covers the deployment runbook and on-call rotation. "
    "Missing: escalation contacts for the payments vendor integration."
)
INTERVIEW_TEXT = (
    "The employee said the main reason for leaving was better compensation "
    "elsewhere. They felt supported by their manager and would consider "
    "returning in the future."
)


def _pick_employee() -> dict:
    cased = {c["employee_id"] for c in db.table("exit_cases").select("employee_id").execute().data or []}
    employees = db.table("profiles").select("*").eq("role", "employee").execute().data or []
    for e in employees:
        if e["employee_id"] not in cased:
            return e
    raise RuntimeError("every seeded employee already has an exit_cases row")


def _create_case(profile: dict) -> dict:
    manager = db.table("profiles").select("id").eq("role", "manager").limit(1).single().execute().data
    hr = db.table("profiles").select("id").eq("role", "hr").limit(1).single().execute().data
    row = {
        "employee_id": profile["employee_id"],
        "employee_name": profile["full_name"],
        "email": profile["email"],
        "department": profile["department"],
        "role_title": DEPARTMENT_TITLES.get(profile["department"], "Specialist"),
        "manager_id": manager["id"],
        "hr_id": hr["id"],
        "last_working_day": (date.today() + timedelta(days=14)).isoformat(),
        "status": "in_progress",
    }
    return db.table("exit_cases").insert(row).execute().data[0]


def run() -> dict:
    profile = _pick_employee()
    case = _create_case(profile)
    case_id = case["id"]

    run_case(case_id, kt_text=KT_TEXT, interview_text=INTERVIEW_TEXT)

    tasks = db.table("exit_tasks").select("*").eq("case_id", case_id).execute().data or []
    assert any(t["stage"] == "hr" for t in tasks), "no HR checklist tasks generated"
    assert any(t["stage"] == "manager" for t in tasks), "no manager/KT tasks generated"
    assert any(t["stage"] == "it" for t in tasks), "no IT deprovisioning tasks generated"

    # Employee/manager/IT complete their items -- the human step every agent
    # here deliberately stops short of (supervisor/it_agent never auto-marks
    # done). Finance is intentionally excluded: it's the thing we're about to
    # flip by completing everything else.
    db.table("exit_tasks").update({"status": "done"}).eq("case_id", case_id).in_(
        "stage", ["hr", "manager", "it"]
    ).execute()

    cleared = check_clearance(case_id)["result"]["cleared"]
    assert cleared, f"finance did not clear after all other tasks were done: {cleared}"

    finance_tasks = db.table("exit_tasks").select("status").eq("case_id", case_id).eq("stage", "finance").execute().data
    assert finance_tasks and all(t["status"] == "done" for t in finance_tasks), "finance task not marked done"

    case_row = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    assert case_row["risk_level"] in ("low", "medium", "high"), f"risk_level not populated: {case_row}"
    assert case_row["risk_score"] is not None, "risk_score not populated"

    interview = db.table("exit_interviews").select("*").eq("case_id", case_id).execute().data
    assert interview and interview[0]["summary"] and interview[0]["sentiment"], "exit interview not analyzed"

    kt_review = db.table("kt_reviews").select("*").eq("case_id", case_id).execute().data
    assert kt_review and kt_review[0]["summary"], "KT review not recorded"

    # Re-query exactly what each dashboard reads for this case (RLS views
    # need a real user JWT to evaluate auth.uid(), which this backend script
    # doesn't have -- so verify the underlying rows the views project from,
    # the same rows Phase 3's RLS already proved each role can reach).
    employee_cols = {"employee_name", "department", "role_title", "last_working_day"}
    assert employee_cols <= case_row.keys() and all(case_row[c] for c in employee_cols), \
        "employee-safe columns missing (employee_exit_view backing data)"
    assert case_row["manager_id"] == db.table("profiles").select("id").eq("role", "manager").limit(1).single().execute().data["id"], \
        "manager_case_view backing data (manager_id) not linked"
    it_rows = db.table("exit_tasks").select("status").eq("case_id", case_id).eq("stage", "it").execute().data
    assert it_rows and all(t["status"] == "done" for t in it_rows), "it_task_view backing data not settled"

    return {
        "case_id": case_id,
        "employee": profile["employee_id"],
        "risk_level": case_row["risk_level"],
        "risk_score": case_row["risk_score"],
        "task_count": len(tasks) + len(finance_tasks),
    }


if __name__ == "__main__":
    summary = run()
    print(
        f"e2e: case {summary['case_id']} ({summary['employee']}) completed end to end -- "
        f"risk={summary['risk_level']} ({summary['risk_score']}), {summary['task_count']} tasks"
    )
