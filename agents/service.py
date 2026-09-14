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

from . import exit_intel_agent, hr_agent, notifications
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

    manager_notice = notifications.send_resignation_notice(case)
    return {"ok": True, "checklist": checklist_result, "manager_notice": manager_notice}


def issue_relieving_letter(case_id: str) -> dict:
    # The frontend already flipped relieving_letter_issued/status via its own
    # anon-key UPDATE (RLS-gated by exit_cases_hr_relieving_letter, 0017) --
    # this just sends the completion-style notice. Non-fatal if this service
    # isn't running, same posture as every other call in this file.
    case = db.table("exit_cases").select("*").eq("id", case_id).single().execute().data
    if not case:
        return {"error": "case not found"}
    result = notifications.send_relieving_letter_notice(case)
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
            "/activate-exit": activate_case,
            "/submit-exit-interview": submit_exit_interview,
            "/issue-relieving-letter": issue_relieving_letter,
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
        case_id = body.get("case_id")
        if not case_id:
            self._json(400, {"error": "case_id required"})
            return
        handler = routes[self.path]
        try:
            result = handler(case_id)
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
