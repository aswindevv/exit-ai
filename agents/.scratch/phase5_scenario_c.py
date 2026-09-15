"""Disposable Phase 5 live-verification script -- Scenario C (IT stage
failure -> retry/recovery -> no duplicate side effects).

Monkeypatches only agents.it_deprovisioning_agent.MockITAdapter (a module
attribute swap in this throwaway script, not a source-code edit) to force a
first-call failure, proving the real execute_approved_tasks()/idempotency-
guard fix against real DB rows: a failed task must be retried on the next
call, and a verified task must never be re-executed.
"""
import sys
sys.path.insert(0, ".")
from agents.config import db
from agents import it_deprovisioning_agent as itd

EMP_ID = "Emp023"
HR_ID = "24774c6e-bf6b-430f-8ba6-621fe8a5c78c"
MANAGER_ID = "7a43e75e-7b0e-46ad-8d6e-f278e9b3f81e"


class _FailOnceAdapter(itd.MockITAdapter):
    calls = 0
    def _run(self, task):
        _FailOnceAdapter.calls += 1
        raise RuntimeError("simulated IT provider outage (scenario C)")


def create_case():
    emp = db.table("profiles").select("*").eq("employee_id", EMP_ID).single().execute().data
    case = db.table("exit_cases").insert({
        "employee_id": EMP_ID, "employee_name": emp["full_name"], "email": emp["email"],
        "department": emp["department"], "role_title": "Operations Analyst",
        "manager_id": MANAGER_ID, "hr_id": HR_ID, "last_working_day": "2026-10-15",
        "status": "open",
    }).execute().data[0]
    task = db.table("exit_tasks").insert({
        "case_id": case["id"], "stage": "it", "title": "Return company laptop", "status": "done",
    }).execute().data[0]
    return case["id"], task["id"]


def cleanup(case_id):
    for table in ["agent_runs", "exit_tasks"]:
        db.table(table).delete().eq("case_id", case_id).execute()
    db.table("exit_cases").delete().eq("id", case_id).execute()


if __name__ == "__main__":
    case_id, task_id = create_case()
    print("created test case:", case_id, "task:", task_id)
    try:
        # Call 1: adapter always fails -> expect verification_failed, task
        # NOT treated as done-forever.
        itd.MockITAdapter = _FailOnceAdapter
        r1 = itd.execute_approved_tasks(case_id)
        print("\n=== call 1 (forced failure) ===", r1)
        assert len(r1) == 1 and r1[0]["verification"]["verified"] is False, r1
        audit1 = db.table("agent_runs").select("status, metadata").eq("case_id", case_id).eq("stage", "it_deprovisioning_execution").execute().data
        assert len(audit1) == 1 and audit1[0]["status"] == "verification_failed", audit1

        # Call 2: same adapter (still always fails) -> must retry the SAME
        # task again (not skip it), proving the idempotency guard only blocks
        # VERIFIED rows, not failed ones.
        calls_before = _FailOnceAdapter.calls
        r2 = itd.execute_approved_tasks(case_id)
        print("\n=== call 2 (still failing, must retry not skip) ===", r2)
        assert len(r2) == 1 and r2[0]["task_id"] == task_id, r2
        assert _FailOnceAdapter.calls > calls_before, "adapter was not actually re-invoked -- guard wrongly skipped the failed task"
        audit2 = db.table("agent_runs").select("status").eq("case_id", case_id).eq("stage", "it_deprovisioning_execution").execute().data
        assert len(audit2) == 2, f"expected 2 audit rows (one per call), got {len(audit2)}"

        # Call 3: restore the REAL adapter -> the retry should now succeed
        # and verify.
        import importlib
        real_module = importlib.reload(itd)
        r3 = real_module.execute_approved_tasks(case_id)
        print("\n=== call 3 (real adapter, should succeed+verify) ===", r3)
        assert len(r3) == 1 and r3[0]["verification"]["verified"] is True, r3

        # Call 4: task is now verified -> must be skipped (no duplicate
        # side effect / re-execution).
        r4 = real_module.execute_approved_tasks(case_id)
        print("\n=== call 4 (already verified, must be skipped) ===", r4)
        assert r4 == [], f"verified task was re-executed -- duplicate side effect! {r4}"
        audit_final = db.table("agent_runs").select("status").eq("case_id", case_id).eq("stage", "it_deprovisioning_execution").execute().data
        assert len(audit_final) == 3, f"expected exactly 3 audit rows total (fail, fail, verified), got {len(audit_final)}"

        print("\nALL SCENARIO C ASSERTIONS PASSED: failure recorded, failed task retried (not stuck), "
              "eventual success verified, verified task never re-executed (no duplicate side effects)")
    finally:
        cleanup(case_id)
        print("\ncleaned up test case", case_id)
