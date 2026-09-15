"""agents.service -- local HTTP bridge that runs the exit pipeline when an
employee submits their resignation.

Why this exists: submit-resignation/index.ts is a Supabase Edge Function --
it runs in Supabase's cloud and has no network path to this machine, where
the Python agent pipeline lives (CLI-only: agents.run_case / agents.supervisor
are invoked locally, there's no HTTP wrapper). So the frontend -- which IS on
this machine in dev -- calls the Edge Function to create the case, then calls
this local service directly to run the pipeline. CLAUDE.md's own NON-NEGOTIABLES
already name "the Python agent service" as a thing with its own env, separate
from the Edge Functions; this is that service, made reachable.

Three endpoints, three jobs: /activate-exit generates the HR checklist (which
is what actually turns "case created" into "checklist populated from
last_working_day", see hr_agent._persist_checklist) and notifies the manager;
/submit-exit-interview runs the Exit-Interview agent; /issue-relieving-letter
sends the closing notice once HR has issued the letter. /activate-exit is
deliberately NOT the
full supervisor_graph: that graph auto-approves the manager gate and runs
IT/finance/risk assessment unconditionally, which would finish an exit case
the moment it's opened -- wrong for a resignation that was just submitted
and hasn't been reviewed by anyone yet.

/validate-document, /execute-deprovisioning, and /finance-settle-check also
each re-run compliance_agent.run_for_case (and the last also
finance_agent.check_clearance) for that one case after their own action, so
compliance/finance status updates automatically instead of only on a manual
`run_case`. Each is the existing agent's own entry point, invoked, not
duplicated -- and each is already idempotent (update-or-insert /
upsert-on-conflict), so re-running on every small event is safe.

ponytail: stdlib http.server, not Flask/FastAPI -- neither is a project
dependency (see requirements.txt) and this is one route.

Run (from repo root, with agents/.venv active, PYTHONIOENCODING=utf-8 on
Windows -- same convention as agents.run_case, needed for the trace's
box-drawing characters):
    python -m agents.service
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import compliance_agent, doc_collection, email_drafting_agent, exit_intel_agent, finance_agent, hr_agent, it_deprovisioning_agent
from .config import db
from .trace import log_db

PORT = 8787
ALLOWED_ORIGIN = "http://localhost:5173"


def activate_case(case_id: str) -> dict:
    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    if not case:
        return {"error": "case not found"}

    checklist_result = hr_agent.generate_checklist(case_id)

    db.table("exit_cases").update({"status": "in_progress"}).eq("id", case_id).execute()
    log_db("update", "exit_cases", rows=1, detail="status -> in_progress")

    manager_notice = email_drafting_agent.resignation_notice(case)
    return {"ok": True, "checklist": checklist_result, "manager_notice": manager_notice}


def issue_relieving_letter(case_id: str) -> dict:
    # The frontend already flipped relieving_letter_issued/status via its own
    # anon-key UPDATE (RLS-gated by exit_cases_hr_relieving_letter, 0017) --
    # this just sends the completion-style notice. Non-fatal if this service
    # isn't running, same posture as every other call in this file.
    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    if not case:
        return {"error": "case not found"}
    result = email_drafting_agent.relieving_letter_notice(case)
    return {"ok": True, "notice": result}


def submit_exit_interview(case_id: str) -> dict:
    # The frontend already INSERTed the raw fields directly (anon key + RLS,
    # per CLAUDE.md) -- this just reads them back with the service key and
    # runs the Exit-Interview agent (exit_intel_agent.run_per_case), which
    # UPDATEs the same row's summary/sentiment/themes/rehire_* in place.
    row = db.table("exit_interviews").select("*").eq("case_id", case_id).single().execute().data
    if not row:
        return {"error": "no exit interview found for case"}
    lines = [f"Reason for leaving: {row.get('reason_for_leaving') or '(not given)'}"]
    if row.get("would_recommend") is not None:
        lines.append(f"Would recommend the company to a friend: {'Yes' if row['would_recommend'] else 'No'}")
    if row.get("feedback"):
        lines.append(f"Feedback: {row['feedback']}")
    if row.get("comments"):
        lines.append(f"Additional comments: {row['comments']}")
    result = exit_intel_agent.run_per_case(case_id, "\n".join(lines))
    return {"ok": True, "analysis": result["result"]}


def validate_document(case_id: str, document_id: str | None) -> dict:
    # The frontend already uploaded the file to Storage and INSERTed the
    # case_documents row itself (anon key + RLS, per CLAUDE.md) -- this just
    # OCR-validates that one row with the service key. Non-fatal if this
    # service isn't running, same posture as every other call in this file.
    if not document_id:
        return {"error": "document_id required"}
    result = doc_collection.validate_one(case_id, document_id)
    # A validated NDA/Asset Return Form can satisfy compliance_agent's
    # matching item directly (DOC_TYPES) -- re-run its existing, idempotent
    # single-case check so the compliance dashboard reflects it without a
    # manual run_case. Scoped to this one case, not the full pipeline.
    compliance = compliance_agent.run_for_case(case_id)
    return {"ok": True, "validation": result, "compliance": compliance}


def execute_deprovisioning(case_id: str) -> dict:
    # The frontend already flipped the task's status to 'done' via its own
    # anon-key UPDATE (exit_tasks_it_update RLS, ItPages.jsx's Approve button)
    # -- this just runs Execute/Verify/Audit (agent #18) with the service key.
    # Non-fatal if this service isn't running, same posture as every other
    # call in this file.
    result = it_deprovisioning_agent.execute_approved_tasks(case_id)
    # IT approval can satisfy compliance_agent's "access revoked" item --
    # re-run the same existing, idempotent single-case check.
    compliance = compliance_agent.run_for_case(case_id)
    return {"ok": True, "executed": result, "compliance": compliance}


def finance_settle_check(case_id: str) -> dict:
    # The frontend already set exit_cases.finance_cleared via its own RLS-
    # scoped RPC (finance_mark_dues_settled, 0014/0027) -- unlike every other
    # trigger in this file there is no existing service.py hook for this
    # action, so this is a new one. finance_agent.check_clearance flips the
    # stage='finance' exit_tasks row to 'done' (HrPages.jsx's
    # readyForRelievingLetter requires that row, not just the flag, to be
    # done) and compliance_agent.run_for_case updates its own
    # finance_approval item. Both are idempotent, single-case re-checks --
    # not the full pipeline.
    finance = finance_agent.check_clearance(case_id)
    compliance = compliance_agent.run_for_case(case_id)
    return {"ok": True, "finance": finance, "compliance": compliance}


def reject_manager_task(case_id: str, task_id: str | None, reason: str | None) -> dict:
    # Unlike every call above, this one IS the write, not a non-fatal
    # side-effect: exit_tasks has no INSERT policy for any role (0002/0004)
    # and its UPDATE policies (0008) pin status to 'done', so a manager's
    # anon-key client has no RLS path to record a rejection at all. This
    # mirrors agents.supervisor._escalate's exact insert -- not a second
    # implementation, just that same DB write made callable for one already
    # in-progress task instead of only from a full graph run.
    if not task_id:
        return {"error": "task_id required"}
    reason = (reason or "").strip()
    if not reason:
        return {"error": "reason required"}
    task = db.table("exit_tasks").select("*").eq("id", task_id).single().execute().data
    if not task or task["case_id"] != case_id:
        return {"error": "task not found for this case"}
    if task["stage"] != "manager" or task["title"].startswith("Escalated"):
        return {"error": "task is not a pending manager KT task"}

    already = (
        db.table("exit_tasks").select("id, escalation_state").eq("case_id", case_id)
        .ilike("title", "Escalated%").execute().data
    )
    existing = already[0] if already else None

    if existing and existing["escalation_state"] == "resolved":
        return {"error": "escalation already resolved for this case"}
    if existing and existing["escalation_state"] == "open":
        return {"ok": True, "already_escalated": True}

    if existing:
        # Rerouted, and the manager rejected again: reopen the SAME
        # escalation record (one per case) rather than inserting a duplicate.
        db.table("exit_tasks").update(
            {"reason": reason, "escalation_state": "open"}
        ).eq("id", existing["id"]).execute()
        log_db("update", "exit_tasks", rows=1, detail="escalation reopened")
    else:
        db.table("exit_tasks").insert({
            "case_id": case_id, "stage": "manager", "status": "pending",
            "title": "Escalated: manager rejected KT plan -- HR review needed",
            "reason": reason, "escalation_state": "open",
        }).execute()
        log_db("insert", "exit_tasks", rows=1, detail="escalation")

    db.table("agent_runs").insert({
        "case_id": case_id, "stage": "escalate",
        "detail": f"escalated to HR, stopping short of IT/finance -- reason: {reason}",
    }).execute()
    log_db("insert", "agent_runs", rows=1, detail="escalated to HR, stopping short of IT/finance")
    return {"ok": True}


def log_escalation_transition(case_id: str, task_id: str | None, action: str | None, actor_name: str | None) -> dict:
    # HR's Re-route/Resolve buttons perform the real state change themselves,
    # directly against Supabase with the anon key -- RLS (0025) restricts that
    # UPDATE to HR and to a valid open->{rerouted,resolved} transition, so
    # "only HR can resolve/re-route" is enforced by Postgres, not by this
    # service. This call just appends the audit trail (who + when) to
    # agent_runs, same spirit as every _record() call in agents.supervisor --
    # and like most calls in this file, it's non-fatal: the real transition
    # already happened before this was called.
    if action not in ("rerouted", "resolved"):
        return {"error": "invalid action"}
    if not task_id:
        return {"error": "task_id required"}
    db.table("agent_runs").insert({
        "case_id": case_id, "stage": "escalate",
        "agent": "hr_escalation_resolution", "status": action,
        "detail": f"HR ({actor_name or 'unknown'}) {action} this escalation",
        "metadata": {"task_id": task_id, "actor_name": actor_name},
    }).execute()
    log_db("insert", "agent_runs", rows=1, detail=f"escalation {action}")
    return {"ok": True}


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler naming)
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        routes = {
            "/activate-exit": lambda body: activate_case(body["case_id"]),
            "/submit-exit-interview": lambda body: submit_exit_interview(body["case_id"]),
            "/issue-relieving-letter": lambda body: issue_relieving_letter(body["case_id"]),
            "/validate-document": lambda body: validate_document(body["case_id"], body.get("document_id")),
            "/execute-deprovisioning": lambda body: execute_deprovisioning(body["case_id"]),
            "/finance-settle-check": lambda body: finance_settle_check(body["case_id"]),
            "/reject-manager-task": lambda body: reject_manager_task(body["case_id"], body.get("task_id"), body.get("reason")),
            "/escalation-audit": lambda body: log_escalation_transition(
                body["case_id"], body.get("task_id"), body.get("action"), body.get("actor_name")
            ),
        }
        if self.path not in routes:
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON body"})
            return
        if not body.get("case_id"):
            self._json(400, {"error": "case_id required"})
            return
        handler = routes[self.path]
        try:
            result = handler(body)
        except Exception as exc:  # pipeline/LLM/DB failure -- report, don't crash the service
            self._json(500, {"error": str(exc)})
            return
        self._json(200, result)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print("[agent-service]", format % args)


def main() -> None:
    server = ThreadingHTTPServer(("localhost", PORT), Handler)
    print(f"[agent-service] listening on http://localhost:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
