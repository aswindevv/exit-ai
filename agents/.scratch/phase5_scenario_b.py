"""Disposable Phase 5 live-verification script -- Scenario B (Manager Rejection)."""
import sys
sys.path.insert(0, ".")
from agents.config import db
from agents import e2e_automation

EMP_ID = "Emp022"
HR_ID = "24774c6e-bf6b-430f-8ba6-621fe8a5c78c"       # Siva
MANAGER_ID = "7a43e75e-7b0e-46ad-8d6e-f278e9b3f81e"  # Aravidhan


def create_case():
    emp = db.table("profiles").select("*").eq("employee_id", EMP_ID).single().execute().data
    case = db.table("exit_cases").insert({
        "employee_id": EMP_ID, "employee_name": emp["full_name"], "email": emp["email"],
        "department": emp["department"], "role_title": "Product Analyst",
        "manager_id": MANAGER_ID, "hr_id": HR_ID, "last_working_day": "2026-10-15",
        "status": "open",
    }).execute().data[0]
    return case["id"]


def cleanup(case_id):
    for table in ["case_documents", "compliance_checks", "kt_reviews", "exit_interviews", "agent_runs", "exit_tasks"]:
        db.table(table).delete().eq("case_id", case_id).execute()
    db.table("exit_cases").delete().eq("id", case_id).execute()


if __name__ == "__main__":
    case_id = create_case()
    print("created test case:", case_id)
    try:
        result = e2e_automation.run(case_id, simulate_rejection=True)
        print("\n=== OUTCOME ===", result["outcome"])
        tasks = db.table("exit_tasks").select("stage, title, status").eq("case_id", case_id).execute().data
        print("\n=== exit_tasks written ===")
        for t in tasks:
            print(" ", t["stage"], "|", t["title"], "|", t["status"])
        # Assert no it/compliance/finance work happened past the rejection.
        stages = {t["stage"] for t in tasks}
        assert "it" not in stages and "compliance" not in stages and "finance" not in stages, stages
        assert any(t["stage"] == "manager" and "Escalated" in t["title"] for t in tasks), tasks
        assert result["outcome"]["status"] == "blocked" and "rejected" in result["outcome"]["reason"]
        print("\nASSERTIONS PASSED: rejection stopped short of it/compliance/finance, escalation task created")
    finally:
        cleanup(case_id)
        print("\ncleaned up test case", case_id)
