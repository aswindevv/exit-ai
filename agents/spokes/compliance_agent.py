# Agent #13: checks that asset return, NDA, and access revocation are all done before
# final clearance is granted. Uses keyword matching on exit_tasks titles and validated
# case_documents rows — no LLM, all deterministic Python logic.
"""Agent #13 -- Compliance Verification (docs/agent_requirements.md #13 / blueprint1.md #13).

NEW: split from risk/finance. Verifies asset return, NDA acknowledgment, and access
revocation are all done before final clearance -- deterministic keyword match over
exit_tasks, OR a validated case_documents row for asset return / NDA (uploaded +
OCR-validated via the Employee Documents page). Blocks by leaving a stage='compliance'
task pending with the specific missing/incomplete items named; never auto-clears past
a human, same posture as it_agent/finance_agent. Idempotent: updates the same task row
instead of piling up duplicates. The compliance-stage summary task itself is always
excluded from the keyword match (else it would match its own pending title forever).

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.compliance_agent --self-check
    python -m agents.spokes.compliance_agent <case_id>
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timezone

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from ..core.config import db
from ..core.trace import log_db, traced_node

CHECKS = {
    "asset return": re.compile(r"laptop|macbook|device|headset|asset|equipment|collect", re.I),
    "NDA": re.compile(r"\bnda\b|non-disclosure|confidentiality", re.I),
    "access revoked": re.compile(r"\baccess\b|\bsso\b|\baccount\b|revoke|deprovision", re.I),
}

# asset return / NDA are also uploadable, OCR-validated documents (case_documents,
# same doc_type strings as EmployeePages.jsx's REQUIRED_DOCS_BASE) -- a validated
# row satisfies the item too, in addition to the exit_tasks keyword match. access
# revoked has no document counterpart, so it's absent here on purpose.
DOC_TYPES = {"asset_return": "Asset Return Form", "nda": "NDA"}


def evaluate(tasks: list[dict], validated_doc_types: frozenset[str] = frozenset()) -> dict:
    """Pure function: which of the three compliance checks are satisfied. A check
    with no matching task at all counts as missing (blocks), not N/A. A validated
    case_documents row for the item's doc_type (see DOC_TYPES) also satisfies it."""
    blocking = []
    for label, pattern in CHECKS.items():
        matches = [t for t in tasks if pattern.search(t.get("title", ""))]
        done = [t for t in matches if t.get("status") == "done"]
        doc_type = DOC_TYPES.get(ITEM_IDS[label])
        if done or (doc_type and doc_type in validated_doc_types):
            continue
        if not matches:
            blocking.append(f"{label}: no task found")
        else:
            blocking.append(f"{label}: pending")
    return {"cleared": not blocking, "blocking_reasons": blocking}


# ---- item-level traceability (docs/agent_requirements.md #13 P1 upgrade) -------
# Every item is sourced from real, already-written data -- no new upstream
# gate logic. asset_return/nda/access_revoked reuse the keyword match above
# (now per-item instead of aggregated); manager/it/finance approval read the
# same rows the human-approval gates themselves already write (supervisor.py's
# manager_gate -> agent_runs, ItDashboard.jsx's Approve button -> exit_tasks
# status, the Finance dashboard's "Mark dues settled" -> exit_cases.finance_cleared).

def _keyword_item(item: str, pattern, tasks: list[dict], validated_doc_types: frozenset[str] = frozenset()) -> dict:
    matches = [t for t in tasks if pattern.search(t.get("title", ""))]
    done = [t for t in matches if t.get("status") == "done"]
    if done:
        return {"item": item, "status": "done", "source": "exit_tasks",
                "evidence": done[0].get("title"), "failure_reason": None}
    doc_type = DOC_TYPES.get(item)
    if doc_type and doc_type in validated_doc_types:
        return {"item": item, "status": "done", "source": "case_documents",
                "evidence": f"{doc_type} validated", "failure_reason": None}
    if not matches:
        return {"item": item, "status": "missing", "source": "exit_tasks",
                "evidence": None, "failure_reason": "no matching task found"}
    return {"item": item, "status": "pending", "source": "exit_tasks",
            "evidence": matches[0].get("title"), "failure_reason": "task not yet done"}


def _manager_item(manager_detail: str | None) -> dict:
    if manager_detail is None:
        return {"item": "manager_approval", "status": "missing", "source": "agent_runs.manager_gate",
                "evidence": None, "failure_reason": "manager gate not yet recorded"}
    if manager_detail == "approved":
        return {"item": "manager_approval", "status": "done", "source": "agent_runs.manager_gate",
                "evidence": manager_detail, "failure_reason": None}
    return {"item": "manager_approval", "status": "pending", "source": "agent_runs.manager_gate",
            "evidence": manager_detail, "failure_reason": f"manager gate recorded: {manager_detail}"}


def _it_item(it_tasks: list[dict]) -> dict:
    if not it_tasks:
        return {"item": "it_approval", "status": "missing", "source": "exit_tasks.stage=it",
                "evidence": None, "failure_reason": "no IT task found"}
    if all(t.get("status") == "done" for t in it_tasks):
        return {"item": "it_approval", "status": "done", "source": "exit_tasks.stage=it",
                "evidence": f"{len(it_tasks)} task(s) done", "failure_reason": None}
    return {"item": "it_approval", "status": "pending", "source": "exit_tasks.stage=it",
            "evidence": f"{len(it_tasks)} task(s)", "failure_reason": "IT tasks not all done (awaiting IT approval)"}


def _finance_item(finance_cleared: bool) -> dict:
    if finance_cleared:
        return {"item": "finance_approval", "status": "done", "source": "exit_cases.finance_cleared",
                "evidence": "finance_cleared=true", "failure_reason": None}
    return {"item": "finance_approval", "status": "pending", "source": "exit_cases.finance_cleared",
            "evidence": "finance_cleared=false", "failure_reason": "dues/settlement not confirmed"}


# CHECKS keys are the human-readable labels used in evaluate()'s
# blocking_reasons text (untouched); item ids here are the normalized,
# stable identifiers persisted to compliance_checks.
ITEM_IDS = {"asset return": "asset_return", "NDA": "nda", "access revoked": "access_revoked"}


def evaluate_items(
    tasks: list[dict],
    manager_detail: str | None,
    it_tasks: list[dict],
    finance_cleared: bool,
    validated_doc_types: frozenset[str] = frozenset(),
) -> list[dict]:
    """Pure function: the 6 required items, each with status/source/evidence/
    failure_reason. Does not decide overall clearance -- evaluate() above
    still owns that gate, untouched."""
    items = [_keyword_item(ITEM_IDS[label], pattern, tasks, validated_doc_types) for label, pattern in CHECKS.items()]
    items.append(_manager_item(manager_detail))
    items.append(_it_item(it_tasks))
    items.append(_finance_item(finance_cleared))
    return items


class ComplianceState(TypedDict):
    case_id: str
    result: dict
    items: list[dict]


def _validated_doc_types(case_id: str) -> frozenset[str]:
    docs = db.table("case_documents").select("doc_type, status").eq("case_id", case_id).eq("status", "validated").execute().data or []
    return frozenset(d["doc_type"] for d in docs)


@traced_node("Compliance Verification -- check")
def _check_node(state: ComplianceState) -> ComplianceState:
    case_id = state["case_id"]
    tasks = db.table("exit_tasks").select("title, status, stage").eq("case_id", case_id).execute().data or []
    # exclude the compliance-stage summary task itself -- its own title (e.g.
    # "...NDA: no task found...") is written by _persist_node and would
    # otherwise keyword-match against the very checks below, self-poisoning
    # every future run. Same filter _items_node already applies.
    keyword_tasks = [t for t in tasks if t.get("stage") != "compliance"]
    state["result"] = evaluate(keyword_tasks, _validated_doc_types(case_id))
    return state


@traced_node("Compliance Verification -- persist")
def _persist_node(state: ComplianceState) -> ComplianceState:
    case_id = state["case_id"]
    result = state["result"]
    status = "done" if result["cleared"] else "pending"
    title = (
        "Compliance verified -- cleared for final clearance" if result["cleared"]
        else "Final clearance blocked: " + "; ".join(result["blocking_reasons"])
    )
    existing = db.table("exit_tasks").select("id").eq("case_id", case_id).eq("stage", "compliance").execute().data
    if existing:
        db.table("exit_tasks").update({"title": title, "status": status}).eq("id", existing[0]["id"]).execute()
        log_db("update", "exit_tasks", rows=1, detail=title)
    else:
        db.table("exit_tasks").insert(
            {"case_id": case_id, "stage": "compliance", "title": title, "status": status}
        ).execute()
        log_db("insert", "exit_tasks", rows=1, detail=title)
    return state


@traced_node("Compliance Verification -- item-level trace (#13)")
def _items_node(state: ComplianceState) -> ComplianceState:
    case_id = state["case_id"]
    tasks = db.table("exit_tasks").select("title, status, stage").eq("case_id", case_id).execute().data or []
    manager_rows = (
        db.table("agent_runs").select("detail, created_at").eq("case_id", case_id).eq("stage", "manager")
        .in_("detail", ["approved", "rejected"]).order("created_at", desc=True).limit(1).execute().data or []
    )
    manager_detail = manager_rows[0]["detail"] if manager_rows else None
    it_tasks = [t for t in tasks if t.get("stage") == "it"]
    case = db.table("exit_cases").select("finance_cleared").eq("id", case_id).single().execute().data or {}
    finance_cleared = bool(case.get("finance_cleared"))

    # exclude the compliance-stage summary task itself: its own title (e.g.
    # "...NDA: no task found...") is written by _persist_node and would
    # otherwise keyword-match against the very NDA/asset/access checks below.
    keyword_tasks = [t for t in tasks if t.get("stage") != "compliance"]
    items = evaluate_items(keyword_tasks, manager_detail, it_tasks, finance_cleared, _validated_doc_types(case_id))
    now = datetime.now(timezone.utc).isoformat()
    for item in items:
        db.table("compliance_checks").upsert({
            "case_id": case_id,
            "item": item["item"],
            "status": item["status"],
            "source": item["source"],
            "evidence": item["evidence"],
            "failure_reason": item["failure_reason"],
            "checked_at": now,
        }, on_conflict="case_id,item").execute()
    done = sum(1 for i in items if i["status"] == "done")
    log_db("upsert", "compliance_checks", rows=len(items), detail=f"{done}/{len(items)} done")
    state["items"] = items
    return state


_graph = StateGraph(ComplianceState)
_graph.add_node("check", _check_node)
_graph.add_node("persist", _persist_node)
_graph.add_node("items", _items_node)
_graph.set_entry_point("check")
_graph.add_edge("check", "persist")
_graph.add_edge("persist", "items")
_graph.set_finish_point("items")
compliance_graph = _graph.compile()


def run_for_case(case_id: str) -> dict:
    return compliance_graph.invoke({"case_id": case_id, "result": {}, "items": []})


def _demo() -> None:
    """Pure-arithmetic self-check, no network -- run with --self-check."""
    missing_nda = evaluate([
        {"title": "Return laptop and access card", "status": "done"},
        {"title": "Revoke SSO account access", "status": "done"},
    ])
    assert not missing_nda["cleared"] and any("NDA" in r for r in missing_nda["blocking_reasons"]), missing_nda

    pending_nda = evaluate([
        {"title": "Sign NDA acknowledgment", "status": "pending"},
        {"title": "Return laptop", "status": "done"},
        {"title": "Revoke account access", "status": "done"},
    ])
    assert not pending_nda["cleared"] and any("NDA" in r for r in pending_nda["blocking_reasons"]), pending_nda

    clear = evaluate([
        {"title": "Sign NDA acknowledgment", "status": "done"},
        {"title": "Return laptop", "status": "done"},
        {"title": "Revoke account access", "status": "done"},
    ])
    assert clear["cleared"] and not clear["blocking_reasons"], clear

    print("compliance_agent self-check passed:", missing_nda, pending_nda, clear)

    tasks = [
        {"title": "Sign NDA acknowledgment", "status": "done"},
        {"title": "Return laptop", "status": "pending"},
        {"title": "Revoke SSO account access", "status": "done", "stage": "it"},
    ]
    items = evaluate_items(tasks, "approved", [{"status": "done"}], False)
    by_item = {i["item"]: i for i in items}
    assert by_item["nda"]["status"] == "done", by_item["nda"]
    assert by_item["asset_return"]["status"] == "pending", by_item["asset_return"]
    assert by_item["access_revoked"]["status"] == "done", by_item["access_revoked"]
    assert by_item["manager_approval"]["status"] == "done", by_item["manager_approval"]
    assert by_item["it_approval"]["status"] == "done", by_item["it_approval"]
    assert by_item["finance_approval"]["status"] == "pending", by_item["finance_approval"]
    assert len(items) == 6, items
    print("compliance_agent evaluate_items self-check passed:", items)

    # regression: with no real NDA task, only the compliance-stage summary
    # task itself (whose title echoes "NDA: no task found", written by
    # _persist_node), the NDA item must read "missing", not spuriously match
    # its own summary task and read "pending". Callers filter stage=
    # "compliance" out before calling evaluate_items -- see _items_node.
    self_ref_tasks = [
        {"title": "Return laptop", "status": "done"},
        {"title": "Final clearance blocked: asset return: pending; NDA: no task found", "status": "pending", "stage": "compliance"},
    ]
    filtered = [t for t in self_ref_tasks if t.get("stage") != "compliance"]
    regression_items = {i["item"]: i for i in evaluate_items(filtered, None, [], False)}
    assert regression_items["nda"]["status"] == "missing", regression_items["nda"]

    # regression (BUG 1): evaluate() has no notion of "stage" -- callers must
    # filter out the compliance-stage summary task before calling it, same as
    # evaluate_items() above. asset_return/access_revoked are genuinely done;
    # only NDA is missing. Once the self-referential summary task is filtered
    # out, it must not re-block on its own stale "asset return: pending;
    # access revoked: pending" title (the real emp053 bug).
    self_ref_case_tasks = [
        {"title": "Return company laptop and access badge", "status": "done"},
        {"title": "Disable SSO account and revoke all login credentials", "status": "done"},
        {"title": "Final clearance blocked: asset return: pending; NDA: pending; access revoked: pending",
         "status": "pending", "stage": "compliance"},
    ]
    filtered_case_tasks = [t for t in self_ref_case_tasks if t.get("stage") != "compliance"]
    self_ref_result = evaluate(filtered_case_tasks)
    assert not any("asset return" in r for r in self_ref_result["blocking_reasons"]), self_ref_result
    assert not any("access revoked" in r for r in self_ref_result["blocking_reasons"]), self_ref_result
    assert any("NDA" in r for r in self_ref_result["blocking_reasons"]), self_ref_result

    # regression (BUG 2): a validated case_documents row for NDA / Asset
    # Return Form satisfies those items even with zero matching exit_tasks --
    # document-based OR task-based signal is enough.
    doc_tasks = [{"title": "Disable SSO account and revoke all login credentials", "status": "done"}]
    doc_result = evaluate(doc_tasks, frozenset({"NDA", "Asset Return Form"}))
    assert doc_result["cleared"] and not doc_result["blocking_reasons"], doc_result

    doc_items = {i["item"]: i for i in evaluate_items(
        doc_tasks, "approved", [{"status": "done"}], True, frozenset({"NDA", "Asset Return Form"})
    )}
    assert doc_items["nda"]["status"] == "done" and doc_items["nda"]["source"] == "case_documents", doc_items["nda"]
    assert doc_items["asset_return"]["status"] == "done" and doc_items["asset_return"]["source"] == "case_documents", doc_items["asset_return"]

    # a case genuinely missing a validated NDA (no task, no validated doc) must still block
    still_missing = {i["item"]: i for i in evaluate_items(
        doc_tasks, "approved", [{"status": "done"}], True, frozenset({"Asset Return Form"})
    )}
    assert still_missing["nda"]["status"] == "missing", still_missing["nda"]
    assert not evaluate(doc_tasks, frozenset({"Asset Return Form"}))["cleared"]

    print("compliance_agent doc-validation + self-reference regression self-check passed")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "--self-check":
        _demo()
    else:
        print(run_for_case(sys.argv[1]))
