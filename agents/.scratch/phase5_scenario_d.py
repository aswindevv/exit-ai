"""Disposable Phase 5 live-verification script -- Scenario D (Approver
OOO/Delegation), against real agents.smart_routing.pick_approver() and real
profiles rows. Plan's #11 acceptance criteria (verbatim):
    Primary available -> Primary selected
    Primary unavailable -> Delegate selected
Temporarily flips profiles.out_of_office on the real Aravidhan/Siva rows and
always restores it to False in finally, regardless of outcome.
"""
import sys
sys.path.insert(0, ".")
from agents.config import db
from agents import smart_routing

EMP_ID = "Emp024"
HR_ID = "24774c6e-bf6b-430f-8ba6-621fe8a5c78c"          # Siva (primary HR)
HR_DELEGATE_ID = "64344fc1-62bf-438d-8a61-55495aefb51f"  # Divya (HR Delegate)
MANAGER_ID = "7a43e75e-7b0e-46ad-8d6e-f278e9b3f81e"          # Aravidhan (primary manager)
MANAGER_DELEGATE_ID = "0f502d00-7720-4005-b91b-1c3168ddcabd"  # Karthik (Manager Delegate)


def create_case():
    emp = db.table("profiles").select("*").eq("employee_id", EMP_ID).single().execute().data
    case = db.table("exit_cases").insert({
        "employee_id": EMP_ID, "employee_name": emp["full_name"], "email": emp["email"],
        "department": emp["department"], "role_title": "HR Coordinator",
        "manager_id": MANAGER_ID, "hr_id": HR_ID, "last_working_day": "2026-10-15",
        "status": "open",
    }).execute().data[0]
    return case["id"]


def cleanup(case_id):
    for table in ["agent_runs", "exit_tasks"]:
        db.table(table).delete().eq("case_id", case_id).execute()
    db.table("exit_cases").delete().eq("id", case_id).execute()


def set_ooo(profile_id, value):
    db.table("profiles").update({"out_of_office": value}).eq("id", profile_id).execute()


if __name__ == "__main__":
    case_id = create_case()
    print("created test case:", case_id)
    try:
        # --- Manager stage ---
        d1 = smart_routing.pick_approver(case_id, "manager")
        print("\n=== manager, primary available ===", d1)
        assert d1["approver"]["id"] == MANAGER_ID and d1["is_delegate"] is False, d1

        set_ooo(MANAGER_ID, True)
        d2 = smart_routing.pick_approver(case_id, "manager")
        print("\n=== manager, primary OOO ===", d2)
        assert d2["approver"]["id"] == MANAGER_DELEGATE_ID and d2["is_delegate"] is True, d2

        # --- HR stage ---
        d3 = smart_routing.pick_approver(case_id, "hr")
        print("\n=== hr, primary available ===", d3)
        assert d3["approver"]["id"] == HR_ID and d3["is_delegate"] is False, d3

        set_ooo(HR_ID, True)
        d4 = smart_routing.pick_approver(case_id, "hr")
        print("\n=== hr, primary OOO ===", d4)
        assert d4["approver"]["id"] == HR_DELEGATE_ID and d4["is_delegate"] is True, d4

        print("\nALL SCENARIO D ASSERTIONS PASSED: primary available -> primary selected; "
              "primary OOO -> real delegate profile selected, for both manager and hr stages")
    finally:
        set_ooo(MANAGER_ID, False)
        set_ooo(HR_ID, False)
        cleanup(case_id)
        print("\nrestored out_of_office=False on both primaries, cleaned up test case", case_id)
