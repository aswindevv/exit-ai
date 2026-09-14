"""Agent #15 -- Multi-System Clearance (agent_requirements.md #15 / blueprint1.md #15).

"Consolidates clearance status across multiple systems (IT asset
management, HRMS, finance)." Those three external systems don't exist in this
project -- there is one Supabase project, not three integrated platforms --
so the three adapters below are DEMO STAND-INS: OUR OWN Supabase tables play
the role of each external system, queried live and for real through a
production-ready adapter contract (no hardcoded/fake status). Stays labeled
NEW-min (not DONE) until real external-system credentials exist; see
agents_spec.md.

Adapter contract (SystemAdapter, below): request/response, system
identifier, timestamps, status (CLEARED/PENDING/FAILED/TIMEOUT), a real
enforced timeout (ThreadPoolExecutor.result(timeout=...), not cosmetic),
retry on error/timeout, and error capture. Swapping a real HRMS/ITAM/Finance
HTTP client in later means overriding _fetch() on each adapter -- nothing
else in this file changes.

Stand-in mapping (each _fetch is a REAL query, not a mock value):
    HRMSAdapter    -> exit_tasks where stage='hr'  (+ case_documents: NDA)
    ITAMAdapter    -> exit_tasks where stage='it'  (+ case_documents: Asset
                      Return Form / Company Asset Declaration)
    FinanceAdapter -> exit_tasks where stage='finance'
All three tables are real, already-written-to tables in THIS project
(finance_agent.py, it_deprovisioning_agent, checklist_generator_agent,
doc_collection.py) -- this agent only reads and consolidates, writes nothing
to them (besides its own agent_runs audit row).

Wired as a tool: supervisor.py calls consolidate() from the compliance stage
node (not a new top-level graph node) -- see agents/supervisor.py.

Run (from repo root, with agents/.venv active):
    python -m agents.multi_system_clearance <case_id>
    python -m agents.multi_system_clearance --self-check
"""
from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from .config import db
from .trace import log_db, traced_node


def _open_items(tasks: list[dict], docs: list[dict]) -> tuple[str, list[str]]:
    """Pure function: a stage's exit_tasks rows + its mapped case_documents
    rows in -> ("cleared"|"pending", open_items) out. No task at all reads
    as pending, not cleared -- a stage that never ran isn't cleared. A doc
    that's uploaded but not yet 'validated' is an open item too, not just an
    incomplete task."""
    open_items = ["no task recorded yet"] if not tasks else [t["title"] for t in tasks if t["status"] != "done"]
    open_items += [f"{d['doc_type']}: {d['status']}" for d in docs if d["status"] != "validated"]
    return ("cleared" if not open_items else "pending"), open_items


class SystemAdapter:
    """Production-ready contract every stand-in adapter below implements --
    request/response shape, timestamps, real enforced timeout, retry, and
    error handling all live here once. MOCK: the three subclasses query
    THIS project's own Supabase tables instead of a real external system
    (see module docstring) -- no real HRMS/ITAM/Finance integration exists."""

    system: str = "unset"
    timeout_seconds: float = 5.0
    max_retries: int = 1

    def _fetch(self, case_id: str) -> tuple[str, list[str]]:
        """Subclass hook: real query in -> ("cleared"|"pending", open_items) out."""
        raise NotImplementedError

    def check_clearance(self, case_id: str) -> dict:
        requested_at = datetime.now(timezone.utc).isoformat()
        status, open_items, error, attempt = "FAILED", [], None, 0
        for attempt in range(self.max_retries + 1):
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    raw_status, open_items = pool.submit(self._fetch, case_id).result(timeout=self.timeout_seconds)
                status, error = ("CLEARED" if raw_status == "cleared" else "PENDING"), None
                break
            except FuturesTimeoutError:
                status, open_items, error = "TIMEOUT", [], f"{self.system} did not respond within {self.timeout_seconds}s"
            except Exception as exc:  # noqa: BLE001 -- a real adapter's request can fail for any reason
                status, open_items, error = "FAILED", [], str(exc)
        return {
            "system": self.system, "status": status, "open_items": open_items,
            "requested_at": requested_at, "responded_at": datetime.now(timezone.utc).isoformat(),
            "retries": attempt, "error": error,
        }


class HRMSAdapter(SystemAdapter):
    """MOCK -- stands in for a real HRMS clearance API (see module docstring)."""
    system = "hrms"

    def _fetch(self, case_id: str) -> tuple[str, list[str]]:
        tasks = db.table("exit_tasks").select("title, status").eq("case_id", case_id).eq("stage", "hr").execute().data or []
        docs = db.table("case_documents").select("doc_type, status").eq("case_id", case_id).eq("doc_type", "NDA").execute().data or []
        return _open_items(tasks, docs)


class ITAMAdapter(SystemAdapter):
    """MOCK -- stands in for a real IT Asset Management clearance API."""
    system = "itam"

    def _fetch(self, case_id: str) -> tuple[str, list[str]]:
        tasks = db.table("exit_tasks").select("title, status").eq("case_id", case_id).eq("stage", "it").execute().data or []
        docs = (db.table("case_documents").select("doc_type, status").eq("case_id", case_id)
                .in_("doc_type", ["Asset Return Form", "Company Asset Declaration"]).execute().data or [])
        return _open_items(tasks, docs)


class FinanceAdapter(SystemAdapter):
    """MOCK -- stands in for a real Finance clearance API. No document type
    maps to finance, so only exit_tasks (stage='finance') is queried."""
    system = "finance"

    def _fetch(self, case_id: str) -> tuple[str, list[str]]:
        tasks = db.table("exit_tasks").select("title, status").eq("case_id", case_id).eq("stage", "finance").execute().data or []
        return _open_items(tasks, [])


def consolidate_status(responses: dict[str, dict], doc_rows: list[dict]) -> dict:
    """Pure function: the three adapters' CLEARED/PENDING/FAILED/TIMEOUT
    responses + all case_documents rows in -> one consolidated status object
    out. No I/O, no LLM -- everything here is dict shaping. Worst-status-wins:
    a system erroring out is worse than one merely pending."""
    doc_issues = [f"{d['doc_type']}: {d['status']}" for d in doc_rows if d["status"] != "validated"]
    statuses = [r["status"] for r in responses.values()]
    if "FAILED" in statuses:
        overall = "FAILED"
    elif "TIMEOUT" in statuses:
        overall = "TIMEOUT"
    elif doc_issues or "PENDING" in statuses:
        overall = "PENDING"
    else:
        overall = "CLEARED"
    return {
        "it_asset_management": responses["itam"],
        "hrms": responses["hrms"],
        "finance": responses["finance"],
        "document_issues": doc_issues,
        "overall": overall,
    }


class ClearanceState(TypedDict):
    case_id: str
    _responses: dict[str, dict]
    _doc_rows: list[dict]
    status: dict


@traced_node("Multi-System Clearance -- query stand-in adapters")
def _fetch(state: ClearanceState) -> ClearanceState:
    case_id = state["case_id"]
    state["_responses"] = {
        "hrms": HRMSAdapter().check_clearance(case_id),
        "itam": ITAMAdapter().check_clearance(case_id),
        "finance": FinanceAdapter().check_clearance(case_id),
    }
    state["_doc_rows"] = db.table("case_documents").select("doc_type, status").eq("case_id", case_id).execute().data or []
    return state


@traced_node("Multi-System Clearance -- consolidate")
def _consolidate(state: ClearanceState) -> ClearanceState:
    status = consolidate_status(state["_responses"], state["_doc_rows"])
    state["status"] = status
    detail = f"overall={status['overall']} it={status['it_asset_management']['status']} " \
             f"hrms={status['hrms']['status']} finance={status['finance']['status']}"
    db.table("agent_runs").insert({"case_id": state["case_id"], "stage": "multi_system_clearance", "detail": detail}).execute()
    log_db("insert", "agent_runs", rows=1, detail=detail)
    return state


_graph = StateGraph(ClearanceState)
_graph.add_node("fetch", _fetch)
_graph.add_node("consolidate", _consolidate)
_graph.set_entry_point("fetch")
_graph.add_edge("fetch", "consolidate")
_graph.set_finish_point("consolidate")
multi_system_clearance_graph = _graph.compile()


def consolidate(case_id: str) -> dict:
    """The tool entry point supervisor.py calls from the compliance stage node."""
    result = multi_system_clearance_graph.invoke({"case_id": case_id, "_responses": {}, "_doc_rows": [], "status": {}})
    return result["status"]


class _AlwaysFailAdapter(SystemAdapter):
    """Self-check only: a real adapter whose _fetch always raises, to
    exercise check_clearance's real FAILED + retry-counting path."""
    system, max_retries = "test-fail", 1

    def _fetch(self, case_id: str) -> tuple[str, list[str]]:
        raise RuntimeError("simulated system outage")


class _AlwaysTimeoutAdapter(SystemAdapter):
    """Self-check only: a real adapter whose _fetch outlives the timeout, to
    exercise check_clearance's real (ThreadPoolExecutor-enforced) TIMEOUT path."""
    system, timeout_seconds, max_retries = "test-timeout", 0.05, 0

    def _fetch(self, case_id: str) -> tuple[str, list[str]]:
        time.sleep(0.3)
        return "cleared", []


class _AlwaysClearAdapter(SystemAdapter):
    """Self-check only: a real adapter that always clears immediately."""
    system = "test-clear"

    def _fetch(self, case_id: str) -> tuple[str, list[str]]:
        return "cleared", []


def _demo() -> None:
    """Pure/deterministic self-check, no live DB -- run with --self-check.
    The FAILED/TIMEOUT/retry paths use the tiny local adapters above (real
    ThreadPoolExecutor timeout enforcement, real retry counting), so this
    stays fast and needs no network."""
    cleared, items = _open_items([{"title": "Return laptop", "status": "done"}], [{"doc_type": "NDA", "status": "validated"}])
    assert cleared == "cleared" and items == [], (cleared, items)

    pending, items2 = _open_items([{"title": "Return laptop", "status": "pending"}], [])
    assert pending == "pending" and items2 == ["Return laptop"], (pending, items2)

    no_task, items3 = _open_items([], [{"doc_type": "NDA", "status": "rejected"}])
    assert no_task == "pending" and items3 == ["no task recorded yet", "NDA: rejected"], (no_task, items3)

    ok = {
        "hrms": {"system": "hrms", "status": "CLEARED", "open_items": [], "requested_at": "t", "responded_at": "t", "retries": 0, "error": None},
        "itam": {"system": "itam", "status": "CLEARED", "open_items": [], "requested_at": "t", "responded_at": "t", "retries": 0, "error": None},
        "finance": {"system": "finance", "status": "CLEARED", "open_items": [], "requested_at": "t", "responded_at": "t", "retries": 0, "error": None},
    }
    s = consolidate_status(ok, [{"doc_type": "NDA", "status": "validated"}])
    assert s["overall"] == "CLEARED", s

    pending_responses = {**ok, "itam": {**ok["itam"], "status": "PENDING", "open_items": ["Return laptop"]}}
    s2 = consolidate_status(pending_responses, [])
    assert s2["overall"] == "PENDING" and s2["it_asset_management"]["status"] == "PENDING", s2

    failed_responses = {**ok, "hrms": {**ok["hrms"], "status": "FAILED", "error": "simulated outage"}}
    s3 = consolidate_status(failed_responses, [])
    assert s3["overall"] == "FAILED", s3

    s4 = consolidate_status(ok, [{"doc_type": "NDA", "status": "rejected"}])
    assert s4["overall"] == "PENDING" and s4["document_issues"] == ["NDA: rejected"], s4

    fail_resp = _AlwaysFailAdapter().check_clearance("x")
    assert fail_resp["status"] == "FAILED" and fail_resp["retries"] == 1 and fail_resp["error"], fail_resp

    timeout_resp = _AlwaysTimeoutAdapter().check_clearance("x")
    assert timeout_resp["status"] == "TIMEOUT" and "did not respond" in timeout_resp["error"], timeout_resp

    clear_resp = _AlwaysClearAdapter().check_clearance("x")
    assert clear_resp["status"] == "CLEARED" and clear_resp["retries"] == 0, clear_resp

    print("multi_system_clearance self-check passed:", {
        "overall_ok": s["overall"], "overall_pending": s2["overall"], "overall_failed": s3["overall"],
        "mock_fail": fail_resp["status"], "mock_timeout": timeout_resp["status"], "mock_clear": clear_resp["status"],
    })


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    elif len(sys.argv) > 1:
        print(consolidate(sys.argv[1]))
    else:
        print(__doc__)
        sys.exit(1)
