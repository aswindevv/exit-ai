"""Agent #16 -- Document Collection (agent_requirements.md #16 / blueprint1.md #16).

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

OCR is REAL: pytesseract against an actual Tesseract binary. If `tesseract` is
not resolvable on PATH (this machine's case), pytesseract.pytesseract.tesseract_cmd
falls back to the TESSERACT_PATH env var (see .env).

Run (from repo root, with agents/.venv active):
    python -m agents.doc_collection <case_id>
    python -m agents.doc_collection --self-check
    python -m agents.doc_collection --make-test-doc <path/to/output.png>
"""
from __future__ import annotations

import os
import shutil
import sys

from langgraph.graph import StateGraph
from typing_extensions import TypedDict

from . import notifications
from .config import db
from .trace import log_db, traced_node

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


def validate_content(doc_type: str, text: str) -> dict:
    """Pure function: doc type + OCR'd text in -> validation verdict out.
    No I/O, no LLM -- everything here is a substring check against real text."""
    text_lower = text.lower()
    matched, missing = [], []
    for group in VALIDATION_RULES.get(doc_type, []):
        (matched if any(p in text_lower for p in group) else missing).append(group[0])
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
    subject = f"Documents needed to complete your exit: {case['employee_name']}"
    intro = "The following documents are still required to complete your offboarding:"
    body = notifications._compose(case["employee_name"], intro, missing, "Please upload these as soon as possible.")
    notifications._send(case["email"], subject, body)
    for doc_type in missing:
        db.table("agent_runs").insert({
            "case_id": state["case_id"], "stage": "doc_collection",
            "detail": f"reminder sent for missing document: {doc_type}",
        }).execute()
    log_db("insert", "agent_runs", rows=len(missing), detail="doc_collection reminders")
    state["reminders_sent"] = len(missing)
    return state


@traced_node("Document Collection -- OCR validate uploads")
def _validate(state: DocState) -> DocState:
    validations = []
    for row in state["_submitted_rows"]:
        if row["status"] != "submitted":
            continue
        text = pytesseract.image_to_string(Image.open(row["file_path"]))
        print(f"[doc_collection] OCR output for {row['doc_type']} ({row['file_path']}):\n{text}")
        verdict = validate_content(row["doc_type"], text)
        new_status = "validated" if verdict["ok"] else "rejected"
        detail = f"matched={verdict['matched']} missing={verdict['missing']}"
        db.table("case_documents").update({"status": new_status, "validation_detail": detail}).eq("id", row["id"]).execute()
        db.table("agent_runs").insert({
            "case_id": state["case_id"], "stage": "doc_collection",
            "detail": f"OCR-validated {row['doc_type']} -> {new_status} ({detail})",
        }).execute()
        validations.append({"doc_type": row["doc_type"], "status": new_status, "ocr_text": text, **verdict})
    log_db("update", "case_documents", rows=len(validations), detail="OCR validation")
    state["validations"] = validations
    return state


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


def _make_test_doc(path: str) -> None:
    """Renders a synthetic NDA-like page (real text, real image file) so
    real OCR has something genuine to read -- no scanned NDA is available in
    this demo, but the OCR step itself (pytesseract + Tesseract binary) is
    100% real, not mocked."""
    from PIL import ImageDraw, ImageFont
    img = Image.new("RGB", (900, 400), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype("arial.ttf", 28)
    lines = [
        "NON-DISCLOSURE AGREEMENT",
        "",
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

    ok = validate_content("NDA", "This NON-DISCLOSURE agreement... Signature: Jane Doe")
    assert ok == {"ok": True, "matched": ["non-disclosure", "signature"], "missing": []}, ok
    bad = validate_content("NDA", "This is just a random memo about lunch.")
    assert bad["ok"] is False and set(bad["missing"]) == {"non-disclosure", "signature"}, bad

    print("doc_collection self-check passed:", {"required_IT": required_documents("IT"), "classify": c, "validate_ok": ok, "validate_bad": bad})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        _demo()
    elif len(sys.argv) > 2 and sys.argv[1] == "--make-test-doc":
        _make_test_doc(sys.argv[2])
    elif len(sys.argv) > 1:
        print(run(sys.argv[1]))
    else:
        print(__doc__)
        sys.exit(1)
