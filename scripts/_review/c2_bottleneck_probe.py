"""READ-ONLY: prove #17's bottleneck_stats produces correct output when breaches DO exist.
Feeds real rows through find_breaches at a future clock, then through bottleneck_stats.
Writes nothing, no LLM, no email."""
from datetime import date, timedelta
from collections import Counter
from agents.config import db
from agents.sla_escalation import find_breaches
from agents.workflow_optimizer import bottleneck_stats

tasks = db.table("exit_tasks").select("id, case_id, stage, title, status, due_date").eq("status", "pending").execute().data or []
cases = {c["id"]: c for c in db.table("exit_cases").select("id, employee_name, department, hr_id, manager_id").execute().data or []}
profiles = {p["id"]: p for p in db.table("profiles").select("id, full_name").execute().data or []}
fut = date.today() + timedelta(days=30)
b = find_breaches(tasks, cases, profiles, fut)
stats = bottleneck_stats(b)
print("as-if", fut, "-> bottleneck_stats:")
for k, v in stats.items():
    print("   ", k, "=", v)
# independent recompute of the same numbers
st = Counter(); dp = Counter(); sc = set()
for x in b:
    st[x["stage"]] += x["days_overdue"]; sc.add(x["case_id"])
    dp[cases[x["case_id"]].get("department")] += x["days_overdue"]
print("\nINDEPENDENT:")
print("    breach_count =", len(b), "| stalled_case_count =", len(sc))
print("    overdue_days_by_stage =", dict(st))
print("    overdue_days_by_department(from exit_cases.department directly) =", dict(dp))
print("    worst_stage =", st.most_common(1)[0][0] if st else None)
print("\nMATCH:",
      stats["breach_count"] == len(b),
      stats["stalled_case_count"] == len(sc),
      stats["overdue_days_by_stage"] == dict(st),
      stats["overdue_days_by_department"] == dict(dp),
      stats["worst_stage"] == (st.most_common(1)[0][0] if st else None))
# fragility probe: what happens to the string-parsed department when the name has a paren
bad = [{"case_id": "x", "stage": "hr", "days_overdue": 3,
        "impact": "blocks final clearance for Karthik (Manager Delegate) (Engineering)"}]
print("\nPARSE PROBE, employee_name containing '(':", bottleneck_stats(bad)["overdue_days_by_department"])
none = [{"case_id": "y", "stage": "hr", "days_overdue": 3,
         "impact": "blocks final clearance for Somebody (n/a)"}]
print("PARSE PROBE, department NULL on the case:", bottleneck_stats(none)["overdue_days_by_department"])
