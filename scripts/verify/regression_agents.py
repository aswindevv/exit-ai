"""REGRESSION 7,8,12-17 — agents and orchestration, real runs on a disposable case.

EMAIL IS SUPPRESSED AT ITS SINGLE CHOKE POINT: every template in
agents/core/notifications.py routes through _send(), so rebinding that one function
guarantees no SMTP call is made by ANY agent in this process. Calendar writes
are suppressed the same way (they create real Google events). No source file
is modified.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import agents.core.notifications as notifications  # noqa: E402

_sent = []


def _no_send(to, subject, body):
    _sent.append(subject)
    return {"sent": False, "logged": True, "to": to, "suppressed": True}


notifications._send = _no_send

import agents.core.calendar_booking as calendar_booking  # noqa: E402
from agents.spokes import hr_agent  # noqa: E402

_booked = []


def _no_cal(case, task):
    _booked.append(task.get("title"))
    return {"skipped": True}


calendar_booking.book_kt_event = _no_cal
hr_agent.book_kt_event = _no_cal

from agents import service  # noqa: E402
from agents.hub import e2e_automation, supervisor  # noqa: E402
from agents.spokes import compliance_agent, it_deprovisioning_agent, risk_agent  # noqa: E402
from agents.core.config import db  # noqa: E402

CASE = sys.argv[1]
REJECT_CASE = sys.argv[2]
results = []


def check(label, ok, detail=""):
    results.append((label, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {label:<42} {detail}")


KT = ("Handover: owns the billing service and the nightly reconciliation job. "
      "Deployment is via the release pipeline; on-call is the platform rotation. "
      "Missing: escalation contacts for the payments vendor, and the runbook for "
      "the quarterly true-up process which only this engineer has performed.")

# ---- 16 supervisor happy path ------------------------------------------------
t0 = time.perf_counter()
out = supervisor.run_case(CASE, kt_text=KT, interview_text="Leaving for a better role. Manager was supportive.")
elapsed = time.perf_counter() - t0
log = out["log"]
check("16 supervisor run_case", len(log) >= 8 and any("assess" in x for x in log), f"{elapsed:.1f}s, {len(log)} stages")

case_row = db.table("exit_cases").select("status, risk_level, risk_score").eq("id", CASE).single().execute().data
check("05 run_case sets status in_progress", case_row["status"] == "in_progress", f"status={case_row['status']}")
check("14 risk scored", case_row["risk_level"] is not None, f"{case_row['risk_level']} ({case_row['risk_score']})")

# ---- 13 KT review -------------------------------------------------------------
kt = db.table("kt_reviews").select("summary, gaps, complete").eq("case_id", CASE).execute().data or []
check("13 KT review persisted", len(kt) > 0 and len(kt[0]["gaps"]) > 0, f"{len(kt)} review(s), {len(kt[0]['gaps']) if kt else 0} gaps")

# ---- 15 compliance ------------------------------------------------------------
cc = db.table("compliance_checks").select("item, status").eq("case_id", CASE).execute().data or []
check("15 compliance item-level rows", len(cc) == 6, f"{sum(1 for x in cc if x['status'] == 'done')}/{len(cc)} items done")

# ---- 07 manager approve (idempotent gate) --------------------------------------
db.table("exit_tasks").update({"status": "done"}).eq("case_id", CASE).eq("stage", "manager").execute()
first = service.manager_approve(CASE)
second = service.manager_approve(CASE)
it_rows = db.table("exit_tasks").select("id").eq("case_id", CASE).eq("stage", "it").execute().data or []
gate = db.table("agent_runs").select("id").eq("case_id", CASE).eq("stage", "manager").eq("detail", "approved").execute().data or []
check("07 manager approve advances", first.get("advanced") is True and len(it_rows) > 0, f"{len(it_rows)} IT tasks")
check("07 manager approve idempotent", len(gate) == 1, f"{len(gate)} gate row(s) after 2 calls")

# ---- 12 IT deprovisioning execute + verify -------------------------------------
db.table("exit_tasks").update({"status": "done"}).eq("case_id", CASE).eq("stage", "it").execute()
execed = it_deprovisioning_agent.execute_approved_tasks(CASE)
again = it_deprovisioning_agent.execute_approved_tasks(CASE)
verified = [e for e in execed if e.get("verification", {}).get("verified")]
check("12 IT execute+verify", len(execed) > 0 and len(verified) == len(execed), f"{len(verified)}/{len(execed)} verified")
check("12 IT execute idempotent", len(again) == 0, f"re-run executed {len(again)}")

# ---- 15b compliance re-run clears where evidence exists -------------------------
comp = compliance_agent.run_for_case(CASE)["result"]
check("15 compliance evaluates", isinstance(comp.get("cleared"), bool), f"cleared={comp['cleared']} {comp.get('blocking_reasons')}")

# ---- 08 rejection / escalation branch -------------------------------------------
rej = supervisor.run_case(REJECT_CASE, kt_text=KT, simulate_rejection=True)
esc = db.table("exit_tasks").select("status, escalation_state, title").eq("case_id", REJECT_CASE).eq("stage", "manager").execute().data or []
esc_rows = [t for t in esc if (t.get("title") or "").startswith("Escalated")]
it_after = db.table("exit_tasks").select("id").eq("case_id", REJECT_CASE).eq("stage", "it").execute().data or []
check("08 rejection escalates", len(esc_rows) == 1 and esc_rows[0]["escalation_state"] == "open", f"{len(esc_rows)} escalation row")
check("08 rejection stops before IT", len(it_after) == 0, f"{len(it_after)} IT tasks (expect 0)")

# ---- 17 end-to-end automation ----------------------------------------------------
e2e = e2e_automation.run(CASE)
outcome = e2e.get("outcome", {})
check("17 e2e automation terminal state", outcome.get("status") in ("completed", "blocked"), str(outcome)[:90])

print(f"\nemails suppressed: {len(_sent)} {_sent}")
print(f"calendar writes suppressed: {len(_booked)}")
ok = sum(1 for _, o, _ in results if o)
print(f"\nAGENT REGRESSION: {ok}/{len(results)} passed")
