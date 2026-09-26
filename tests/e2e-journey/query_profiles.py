"""Query profiles and check Emp080/Emp081 — health check helper."""
import sys
sys.path.insert(0, ".")
from agents.core.config import db

rows = db.table("profiles").select("id,full_name,email,role,employee_id").in_("role", ["hr","manager","it","finance"]).execute().data
print("=== Role accounts ===")
for r in rows:
    print(f"  {r['role']:10} | {r['full_name']:20} | {r['email']}")

emps = db.table("profiles").select("id,full_name,email,role,employee_id").in_("employee_id", ["Emp080","Emp081"]).execute().data
print("\n=== Emp080/Emp081 profiles ===")
for r in emps:
    print(f"  {r['employee_id']} | {r['full_name']} | {r['email']}")

if emps:
    emp_ids = [r["employee_id"] for r in emps]
    cases = db.table("exit_cases").select("id,employee_id,status").in_("employee_id", emp_ids).execute().data
    print("\n=== Emp080/Emp081 exit cases ===")
    if cases:
        for c in cases:
            print(f"  {c['employee_id']} case: id={c['id'][:8]}... status={c['status']}")
    else:
        print("  NONE (clean)")

# Check total case count (seeded cases)
total = db.table("exit_cases").select("id", count="exact", head=True).execute()
print(f"\nTotal exit_cases in DB: {total.count}")
