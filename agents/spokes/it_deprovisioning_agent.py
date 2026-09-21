"""Agent #18 -- Automated IT Deprovisioning (docs/agent_requirements.md #18).

Required flow (24-agent-exit-management-phased-implementation-plan.md,
Phase 4 #18): Generate Deprovisioning Plan -> Human Approval -> Execute
Through Adapter -> Verify Execution -> Audit.

Generate: it_agent.generate_plan already does this -- generate() below is a
thin, individually traced name for that capability, per blueprint1.md's
mapping ("IT agent <- #3, #18 deprovisioning"). Does NOT reimplement or
modify it_agent.py.

Human Approval: unchanged and untouched -- src/routes/it/ItPages.jsx's
Approve button flips one exit_tasks row to status='done' directly (anon key
+ RLS). Neither that click handler nor the exit_tasks_it_update RLS
grant/policy are modified by this file.

Execute/Verify/Audit (new): "a task marked done is not proof deprovisioning
actually executed" (plan, Critical). No real IT provider (Okta/Jamf/etc)
exists in this project, so MockITAdapter is an explicit MOCK -- it does not
call anything real. execute_approved_tasks() scans for stage='it' tasks the
human has already approved, runs each through the mock adapter, independently
re-derives the expected action so verification can actually catch a
mismatch (not just re-read its own write), and records one agent_runs row per
task (metadata.task_id) as both the audit trail and the idempotency guard --
re-running never re-executes an already-audited task.

Wired live: agents.service's /execute-deprovisioning route calls
execute_approved_tasks(); the frontend's approveTask() calls that route
right after its own update succeeds, non-fatal if the service isn't running
-- same best-effort pattern already used for /validate-document in
EmployeePages.jsx's Documents() upload handler. See agents/service.py.

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.it_deprovisioning_agent --execute <case_id>
    python -m agents.spokes.it_deprovisioning_agent --self-check
"""
from __future__ import annotations

import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

from . import it_agent
from ..core.config import db
from ..core.trace import log_db, traced_node

# ponytail: mirrors ItPages.jsx's own title-keyword categorization exactly
# (see it_agent.py's module docstring for the frontend contract) so the mock
# adapter's simulated action always matches what the IT dashboard already
# shows for a given task title.
ASSET_RE = re.compile(r"laptop|macbook|device|headset|card|asset|collect", re.I)
IDENTITY_RE = re.compile(r"sso|identity|account", re.I)
REPO_RE = re.compile(r"repo|repository|source|git", re.I)


def _classify_action(title: str) -> str:
    """Pure function: task title in -> mock action-type out."""
    if ASSET_RE.search(title):
        return "asset_recovery"
    if IDENTITY_RE.search(title):
        return "identity_sso_revoke"
    if REPO_RE.search(title):
        return "source_control_revoke"
    return "saas_app_revoke"


def _verify_execution(task: dict, execution: dict) -> dict:
    """Pure function: independently re-derives the expected action type from
    the task title and cross-checks it against what the adapter itself
    reported, so a task the adapter mis-executed (wrong action, or ok=True
    with no real effect) doesn't get waved through just because it ran."""
    expected = _classify_action(task["title"])
    verified = execution.get("ok") is True and execution.get("action_type") == expected
    return {
        "verified": verified,
        "expected_action_type": expected,
        "reported_action_type": execution.get("action_type"),
        "reason": None if verified else (execution.get("detail") or "action_type mismatch"),
    }


class MockITAdapter:
    """MOCK -- stands in for a real IT provisioning API (Okta/Google
    Workspace/Jamf/etc). No real IT system integration exists; _run below is
    a simulation, not a live call. Same adapter contract as
    multi_system_clearance.SystemAdapter: real enforced timeout
    (ThreadPoolExecutor.result(timeout=...)), real retry counting, and real
    exception handling -- a transient outage/timeout gets retried before
    being reported as a real failure (Phase 5 Scenario C: 'retry/recovery
    logic' for an IT/Finance stage failure)."""

    timeout_seconds: float = 5.0
    max_retries: int = 1

    def _run(self, task: dict) -> dict:
        return {"ok": True, "action_type": _classify_action(task["title"]), "detail": f"mock action completed for '{task['title']}'"}

    def execute(self, task: dict) -> dict:
        result = None
        for attempt in range(self.max_retries + 1):
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    result = pool.submit(self._run, task).result(timeout=self.timeout_seconds)
                break
            except FuturesTimeoutError:
                result = {"ok": False, "action_type": _classify_action(task["title"]), "detail": f"mock IT provider did not respond within {self.timeout_seconds}s"}
            except Exception as exc:  # noqa: BLE001 -- a real adapter's request can fail for any reason
                result = {"ok": False, "action_type": _classify_action(task["title"]), "detail": str(exc)}
        return {**result, "retries": attempt}


@traced_node("Automated IT Deprovisioning agent (#18) -- generate plan")
def generate(case_id: str, force: bool = False) -> dict:
    return it_agent.generate_plan(case_id, force=force)


@traced_node("Automated IT Deprovisioning agent (#18) -- execute/verify/audit approved tasks")
def execute_approved_tasks(case_id: str) -> list[dict]:
    """Execute Through Adapter -> Verify Execution -> Audit, for exit_tasks
    the human has already approved (stage='it', status='done'). Idempotent:
    skips any task_id that already has an agent_runs audit row for this
    stage."""
    tasks = db.table("exit_tasks").select("id, title").eq("case_id", case_id).eq("stage", "it").eq("status", "done").execute().data or []
    if not tasks:
        return []
    # Idempotency guard: only a task that already VERIFIED is a real
    # duplicate-side-effect risk. A task that previously failed/timed-out
    # must stay retryable on the next call -- a task marked done that never
    # actually executed must not get stuck that way forever (Phase 5
    # Scenario C: retry/recovery, not a permanent dead end).
    audited = db.table("agent_runs").select("status, metadata").eq("case_id", case_id).eq("stage", "it_deprovisioning_execution").execute().data or []
    already_executed = {r["metadata"]["task_id"] for r in audited if r.get("status") == "verified" and r.get("metadata", {}).get("task_id")}

    adapter = MockITAdapter()
    results = []
    for task in tasks:
        if task["id"] in already_executed:
            continue
        execution = adapter.execute(task)
        verification = _verify_execution(task, execution)
        status = "verified" if verification["verified"] else "verification_failed"
        db.table("agent_runs").insert({
            "case_id": case_id, "stage": "it_deprovisioning_execution", "agent": "it_deprovisioning_agent",
            "status": status, "detail": f"{task['title']} -> {execution.get('detail')} ({status})",
            "metadata": {"task_id": task["id"], "execution": execution, "verification": verification},
        }).execute()
        results.append({"task_id": task["id"], "title": task["title"], "execution": execution, "verification": verification})

    log_db("insert", "agent_runs", rows=len(results), detail="it_deprovisioning_execution")
    return results


class _AlwaysFailAdapter(MockITAdapter):
    """Self-check only: _run always raises, to exercise execute()'s real
    FAILED path."""

    def _run(self, task: dict) -> dict:
        raise RuntimeError("simulated IT provider outage")


class _AlwaysTimeoutAdapter(MockITAdapter):
    """Self-check only: _run outlives the timeout, to exercise execute()'s
    real (ThreadPoolExecutor-enforced) TIMEOUT path."""

    timeout_seconds = 0.05

    def _run(self, task: dict) -> dict:
        time.sleep(0.3)
        return {"ok": True, "action_type": _classify_action(task["title"]), "detail": "too slow"}


def _demo() -> None:
    """Pure/deterministic self-check, no live DB -- run with --self-check."""
    assert _classify_action("Return company laptop") == "asset_recovery"
    assert _classify_action("Disable SSO account") == "identity_sso_revoke"
    assert _classify_action("Revoke GitHub repository access") == "source_control_revoke"
    assert _classify_action("Remove from Slack workspace") == "saas_app_revoke"

    task = {"id": "t1", "title": "Return company laptop"}
    ok_execution = {"ok": True, "action_type": "asset_recovery", "detail": "mock action completed for 'Return company laptop'"}
    v_ok = _verify_execution(task, ok_execution)
    assert v_ok["verified"] is True, v_ok

    # A task marked done that the adapter itself mis-executed (wrong action
    # type reported) must NOT verify -- exactly the "done is not proof" gap
    # the plan calls out.
    mismatched_execution = {"ok": True, "action_type": "saas_app_revoke", "detail": "wrong action"}
    v_bad = _verify_execution(task, mismatched_execution)
    assert v_bad["verified"] is False and v_bad["reason"] == "wrong action", v_bad

    clear_resp = MockITAdapter().execute(task)
    assert clear_resp["ok"] is True and clear_resp["action_type"] == "asset_recovery" and clear_resp["retries"] == 0, clear_resp

    # Both failure modes retry max_retries times (inherited =1) before
    # reporting FAILED -- a transient blip alone wouldn't reach this far.
    fail_resp = _AlwaysFailAdapter().execute(task)
    assert fail_resp["ok"] is False and "outage" in fail_resp["detail"] and fail_resp["retries"] == 1, fail_resp

    timeout_resp = _AlwaysTimeoutAdapter().execute(task)
    assert timeout_resp["ok"] is False and "did not respond" in timeout_resp["detail"] and timeout_resp["retries"] == 1, timeout_resp

    print("it_deprovisioning_agent self-check passed:", {
        "verify_ok": v_ok["verified"], "verify_bad": v_bad["verified"],
        "mock_execute": clear_resp["ok"], "mock_fail": fail_resp["ok"], "mock_timeout": timeout_resp["ok"],
    })


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    elif len(sys.argv) > 2 and sys.argv[1] == "--execute":
        print(execute_approved_tasks(sys.argv[2]))
    elif len(sys.argv) > 1:
        print(generate(sys.argv[1]))
    else:
        print(__doc__)
        sys.exit(1)
