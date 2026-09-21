# Agent #16: tracks which documents (NDA, Asset Return Form, etc.) an employee has uploaded,
# sends email reminders for missing ones, and validates uploads using real Tesseract OCR —
# checking that the file actually contains the expected keywords and the employee's own name.
"""Agent #16 -- Document Collection (docs/agent_requirements.md #16 / blueprint1.md #16).

NEW. "Identifies required documents for an exit case, checks which are
submitted, sends reminders for missing ones, and validates uploads using
vision/OCR." Realized as a three-node subgraph (gather -> remind -> validate),
same shape as the rest of the family. Reminders reuse
notifications._compose/_send directly (not a fresh formatter), same reuse
convention as sla_escalation.py.

Documents live in case_documents (0011_case_documents.sql) -- one row per
*submitted* upload; "missing" is the set difference against the required list,
computed at read time, not a stored status. Required docs are a deterministic
Python list (base + department extras), same shape as checklist_generator's
role/dept -> tasks logic -- no LLM arithmetic.

case_documents.file_path is a path inside the private 'exit-documents' Storage
bucket (0024_case_documents_employee_upload.sql), '<case_id>/<doc_type>-
<timestamp>.<ext>' -- the employee's browser uploads there directly with the
anon key (RLS-scoped to their own case), then INSERTs the row itself. This
service downloads the object with the service key (bypasses RLS, same as
every other table read in this file) to run real OCR against the bytes.

OCR is REAL: pytesseract against an actual Tesseract binary. If `tesseract` is
not resolvable on PATH (this machine's case), pytesseract.pytesseract.tesseract_cmd
falls back to the TESSERACT_PATH env var (see .env).

Run (from repo root, with agents/.venv active):
    python -m agents.spokes.doc_collection <case_id>
    python -m agents.spokes.doc_collection --self-check
    python -m agents.spokes.doc_collection --make-test-doc <path/to/output.png>
"""
from __future__ import annotations

import io
import os
import re
import shutil
import sys

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import email_drafting_agent
from ..core.config import db
from ..core.trace import log_db, traced_node

import pytesseract
from PIL import Image

# pytesseract shells out to the real `tesseract` binary. Prefer PATH; fall
# back to TESSERACT_PATH (set in .env) when it isn't on PATH -- exactly the
# case on this machine (installed, not added to PATH).
if not shutil.which("tesseract") and os.environ.get("TESSERACT_PATH"):
    pytesseract.pytesseract.tesseract_cmd = os.environ["TESSERACT_PATH"]

# ponytail: flat base list + a department extra, not a full role/dept matrix
# like checklist_generator's -- there's no per-role document policy to model
# yet. Upgrade: move this to a table once documents vary by role, not just dept.
BASE_REQUIRED_DOCS = ["NDA", "Asset Return Form"]
DEPT_EXTRA_DOCS = {"IT": ["Company Asset Declaration"], "Engineering": ["Company Asset Declaration"]}

# Each doc type's expected-content check: a list of keyword groups: EVERY
# group needs >=1 case-insensitive substring match in the OCR text for the
# document to validate. Mirrors an NDA needing both "this is an NDA" language
# AND a signature marker -- either alone isn't a signed NDA.
VALIDATION_RULES = {
    "NDA": [["non-disclosure", "confidential"], ["signature", "signed"]],
    "Asset Return Form": [["asset"], ["return", "returned"]],
    "Company Asset Declaration": [["asset"], ["declar"]],
}

# Plan's "Employee identity where applicable" + "Dates" checks -- separate
# from VALIDATION_RULES because they're per-case dynamic (the employee's own
# name) / pattern-based (any date format), not a fixed keyword list. Applies
# to all three current doc types: each is a personal attestation the
# employee signs/declares themselves, so both are always "applicable" today.
DATE_RE = re.compile(r"\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{2,4}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}")


def required_documents(department: str | None) -> list[str]:
    """Pure function: department in -> required doc-type list out."""
    return BASE_REQUIRED_DOCS + DEPT_EXTRA_DOCS.get(department or "", [])


def classify_documents(required: list[str], submitted_rows: list[dict]) -> dict:
    """Pure function: required list + case_documents rows in -> required vs
    submitted vs missing out. A row in ANY status (submitted/validated/
    rejected) counts as "submitted" -- rejected means uploaded-but-invalid,
    not missing."""
    submitted_types = {r["doc_type"] for r in submitted_rows}
    return {
        "required": required,
        "submitted": [d for d in required if d in submitted_types],
        "missing": [d for d in required if d not in submitted_types],
    }


def validate_content(doc_type: str, text: str, employee_name: str | None = None) -> dict:
    """Pure function: doc type + OCR'd text (+ the case's employee name, when
    identity is applicable) in -> validation verdict out. No I/O, no LLM --
    everything here is a substring/regex check against real text. Caller must
    confirm doc_type is actually required for this case first -- an
    unrecognized doc_type has no VALIDATION_RULES entry, so it would
    otherwise auto-pass with missing=[]."""
    text_lower = text.lower()
    matched, missing = [], []
    for group in VALIDATION_RULES.get(doc_type, []):
        (matched if any(p in text_lower for p in group) else missing).append(group[0])
    if employee_name:
        (matched if employee_name.lower() in text_lower else missing).append("employee identity")
    (matched if DATE_RE.search(text) else missing).append("date")
    return {"ok": not missing, "matched": matched, "missing": missing}


class DocState(TypedDict):
    case_id: str
    classification: dict
    reminders_sent: int
    validations: list[dict]
    _case: dict
    _submitted_rows: list[dict]


@traced_node("Document Collection -- gather required vs submitted")
def _gather(state: DocState) -> DocState:
    case = db.table("exit_cases").select("id, employee_name, email, department").eq("id", state["case_id"]).single().execute().data
    rows = db.table("case_documents").select("*").eq("case_id", state["case_id"]).execute().data or []
    required = required_documents(case.get("department"))
    state["_case"] = case
    state["_submitted_rows"] = rows
    state["classification"] = classify_documents(required, rows)
    return state


@traced_node("Document Collection -- remind missing")
def _remind(state: DocState) -> DocState:
    case = state["_case"]
    missing = state["classification"]["missing"]
    if not missing:
        state["reminders_sent"] = 0
        return state
    email_drafting_agent.doc_reminder(case, missing)
    for doc_type in missing:
        db.table("agent_runs").insert({
            "case_id": state["case_id"], "stage": "doc_collection",
            "detail": f"reminder sent for missing document: {doc_type}",
        }).execute()
    log_db("insert", "agent_runs", rows=len(missing), detail="doc_collection reminders")
    state["reminders_sent"] = len(missing)
    return state


def _required_type_verdict(doc_type: str, department: str | None, text: str, employee_name: str | None = None) -> dict:
    """Pure function: guards validate_content with the one check it can't do
    itself -- is doc_type even required for this department? An unrecognized
    doc_type has no VALIDATION_RULES entry, so validate_content alone would
    silently auto-pass it (missing=[])."""
    if doc_type not in required_documents(department):
        return {"ok": False, "matched": [], "missing": ["not a required document type for this case"]}
    return validate_content(doc_type, text, employee_name)


def _validate_row(case_id: str, department: str | None, employee_name: str | None, row: dict) -> dict:
    """Real work behind one case_documents row: download the uploaded object
    from Storage, OCR it, then _required_type_verdict. Shared by the batch
    _validate node and the single-document validate_one() entry point below."""
    required = row["doc_type"] in required_documents(department)
    if required:
        file_bytes = db.storage.from_("exit-documents").download(row["file_path"])
        text = pytesseract.image_to_string(Image.open(io.BytesIO(file_bytes)))
        print(f"[doc_collection] OCR output for {row['doc_type']} ({row['file_path']}):\n{text}")
    else:
        text = ""
    verdict = _required_type_verdict(row["doc_type"], department, text, employee_name)
    new_status = "validated" if verdict["ok"] else "rejected"
    detail = f"matched={verdict['matched']} missing={verdict['missing']}"
    db.table("case_documents").update({"status": new_status, "validation_detail": detail}).eq("id", row["id"]).execute()
    db.table("agent_runs").insert({
        "case_id": case_id, "stage": "doc_collection",
        "detail": f"OCR-validated {row['doc_type']} -> {new_status} ({detail})",
    }).execute()
    return {"doc_type": row["doc_type"], "status": new_status, "ocr_text": text, **verdict}


@traced_node("Document Collection -- OCR validate uploads")
def _validate(state: DocState) -> DocState:
    validations = [
        _validate_row(state["case_id"], state["_case"].get("department"), state["_case"].get("employee_name"), row)
        for row in state["_submitted_rows"] if row["status"] == "submitted"
    ]
    log_db("update", "case_documents", rows=len(validations), detail="OCR validation")
    state["validations"] = validations
    return state


def validate_one(case_id: str, document_id: str) -> dict:
    """Validate a single just-uploaded row without re-running the whole
    graph -- _remind unconditionally re-sends a reminder email for every
    still-missing doc type on each run(case_id) call, so re-running the full
    graph after every upload would spam reminders. Called by
    agents.service's /validate-document route right after an employee
    upload."""
    case = db.table("exit_cases").select("id, department, employee_name").eq("id", case_id).single().execute().data
    row = db.table("case_documents").select("*").eq("id", document_id).eq("case_id", case_id).single().execute().data
    return _validate_row(case_id, case.get("department"), case.get("employee_name"), row)


_graph = StateGraph(DocState)
_graph.add_node("gather", _gather)
_graph.add_node("remind", _remind)
_graph.add_node("validate", _validate)
_graph.set_entry_point("gather")
_graph.add_edge("gather", "remind")
_graph.add_edge("remind", "validate")
_graph.set_finish_point("validate")
doc_collection_graph = _graph.compile()


def run(case_id: str) -> dict:
    return doc_collection_graph.invoke({"case_id": case_id, "classification": {}, "reminders_sent": 0, "validations": []})


def _make_test_doc(path: str, employee_name: str = "Test Employee") -> None:
    """Renders a synthetic NDA-like page (real text, real image file) so
    real OCR has something genuine to read -- no scanned NDA is available in
    this demo, but the OCR step itself (pytesseract + Tesseract binary) is
    100% real, not mocked. Pass the actual logged-in employee's name (must
    match exit_cases.employee_name) so the identity check also passes when
    uploaded via the Employee Documents page -- putting it through the real
    Storage + case_documents + OCR path end to end."""
    from PIL import ImageDraw, ImageFont
    img = Image.new("RGB", (900, 420), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype("arial.ttf", 28)
    lines = [
        "NON-DISCLOSURE AGREEMENT",
        "",
        f"Employee: {employee_name}",
        "This confidential agreement is entered into by the employee",
        "to protect company trade secrets after departure.",
        "",
        "Signature: ____________________   Date: 13-Sep-2026",
    ]
    draw.multiline_text((30, 30), "\n".join(lines), fill="black", font=font, spacing=12)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    img.save(path)
    print(f"wrote test doc: {path}")


def _demo() -> None:
    """Pure-logic self-check, no network/OCR -- run with --self-check."""
    assert required_documents("IT") == ["NDA", "Asset Return Form", "Company Asset Declaration"]
    assert required_documents("Sales") == ["NDA", "Asset Return Form"]

    rows = [{"doc_type": "NDA", "status": "validated"}, {"doc_type": "Asset Return Form", "status": "rejected"}]
    c = classify_documents(["NDA", "Asset Return Form", "Company Asset Declaration"], rows)
    assert c["submitted"] == ["NDA", "Asset Return Form"] and c["missing"] == ["Company Asset Declaration"], c

    ok = validate_content("NDA", "This NON-DISCLOSURE agreement is signed by Jane Doe. Signature: Jane Doe. Date: 13-Sep-2026", employee_name="Jane Doe")
    assert ok == {"ok": True, "matched": ["non-disclosure", "signature", "employee identity", "date"], "missing": []}, ok
    bad = validate_content("NDA", "This is just a random memo about lunch.")
    assert bad["ok"] is False and set(bad["missing"]) == {"non-disclosure", "signature", "date"}, bad

    # A document with the right keywords AND a date, but signed by the wrong
    # person, must still fail -- content alone (or a date alone) isn't proof
    # of identity, same "done is not proof" gap the plan calls out.
    wrong_person = validate_content("NDA", "NON-DISCLOSURE... Signature: John Smith. Date: 13-Sep-2026", employee_name="Jane Doe")
    assert wrong_person["ok"] is False and wrong_person["missing"] == ["employee identity"], wrong_person

    no_date = validate_content("NDA", "NON-DISCLOSURE... Signature: Jane Doe, no date given", employee_name="Jane Doe")
    assert no_date["ok"] is False and no_date["missing"] == ["date"], no_date

    unrequired = _required_type_verdict("Passport", "Sales", "anything at all, doesn't matter")
    assert unrequired["ok"] is False and "not a required document type for this case" in unrequired["missing"], unrequired

    print("doc_collection self-check passed:", {
        "required_IT": required_documents("IT"), "classify": c, "validate_ok": ok, "validate_bad": bad,
        "wrong_person_missing": wrong_person["missing"], "no_date_missing": no_date["missing"], "unrequired": unrequired,
    })


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    elif len(sys.argv) > 2 and sys.argv[1] == "--make-test-doc":
        _make_test_doc(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "Test Employee")
    elif len(sys.argv) > 1:
        print(run(sys.argv[1]))
    else:
        print(__doc__)
        sys.exit(1)
