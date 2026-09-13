"""agents.run_case -- single terminal entry point for the supervisor hub.

Runs one exit case through the full hub-and-spoke pipeline (HR -> manager
gate -> IT -> finance -> assess) and streams the live @traced_node trace --
every spoke's start, inputs, LLM calls (model/latency/tokens), DB writes,
output, and total time, indented under the hub so the hub<->spoke handoffs
read in order (see trace.py). Thin wrapper around agents.supervisor.run_case;
no agent logic duplicated here.

Run (from repo root, with agents/.venv active, PYTHONIOENCODING=utf-8 on
Windows):
    python -m agents.run_case <case_id>
    python -m agents.run_case <case_id> --reject
    python -m agents.run_case <case_id> --kt-text path.txt --interview-text path.txt

Without --kt-text/--interview-text, uses the same demo handover/interview
text agents.e2e_test does, so a bare run still exercises the KT-review and
exit-interview spokes instead of silently skipping them.
"""
from __future__ import annotations

import sys
import time

from .supervisor import run_case as _run_case

DEFAULT_KT_TEXT = (
    "Handover doc: covers the deployment runbook and on-call rotation. "
    "Missing: escalation contacts for the payments vendor integration."
)
DEFAULT_INTERVIEW_TEXT = (
    "The employee said the main reason for leaving was better compensation "
    "elsewhere. They felt supported by their manager and would consider "
    "returning in the future."
)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    case_id = sys.argv[1]
    args = sys.argv[2:]
    kt_text = _read(args[args.index("--kt-text") + 1]) if "--kt-text" in args else DEFAULT_KT_TEXT
    interview_text = (
        _read(args[args.index("--interview-text") + 1]) if "--interview-text" in args else DEFAULT_INTERVIEW_TEXT
    )

    start = time.perf_counter()
    result = _run_case(case_id, kt_text=kt_text, interview_text=interview_text, simulate_rejection="--reject" in args)
    elapsed = time.perf_counter() - start
    print(f"\ncase {case_id} finished in {elapsed:.2f}s -- log: {result['log']}")
