"""READ-ONLY probe: import find_breaches and run it against live tasks.
Does NOT invoke the graph, does NOT call _escalate, sends NO email, writes NOTHING."""
from datetime import date, timedelta
from collections import Counter
from agents.config import db
from agents.sla_escalation import find_breaches, THRESHOLD_DAYS

tasks = db.table("exit_tasks").select("id, case_id, stage, title, status, due_date").eq("status", "pending").execute().data or []
cases = {c["id"]: c for c in db.table("exit_cases").select("id, employee_name, department, hr_id, manager_id").execute().data or []}
profiles = {p["id"]: p for p in db.table("profiles").select("id, full_name").execute().data or []}
today = date.today()
print(f"THRESHOLD_DAYS={THRESHOLD_DAYS}  today={today}")
print(f"pending tasks fetched={len(tasks)}  with due_date={sum(1 for t in tasks if t.get('due_date'))}  NULL due_date={sum(1 for t in tasks if not t.get('due_date'))}")

b = find_breaches(tasks, cases, profiles, today)
print(f"\nLIVE BREACHES TODAY: {len(b)}")
for x in b:
    print("   ", x["employee_name"], "|", x["stage"], "|", x["days_overdue"], "d |", x["blocker"], "|", x["title"][:50])

# prove the detector itself works: same real rows, clock advanced
for delta in (7, 14, 30, 60):
    fut = today + timedelta(days=delta)
    bf = find_breaches(tasks, cases, profiles, fut)
    names = Counter(x["employee_name"] for x in bf)
    blockers = Counter(x["blocker"] for x in bf)
    print(f"\n  as-if today were {fut} (+{delta}d): {len(bf)} breaches over {len(names)} employees")
    if bf:
        print("     top blockers:", dict(blockers.most_common(5)))
        print("     employees:", ", ".join(f"{n}({c})" for n, c in names.most_common(8)))
        ex = bf[0]
        print("     example:", ex["blocker"], "->", ex["title"][:45], "|", ex["days_overdue"], "d |", ex["impact"])
print("\nNO WRITE, NO EMAIL: _escalate was never invoked.")
