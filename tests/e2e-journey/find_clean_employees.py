"""Find employees with no exit case — for clean test targets."""
import sys
sys.path.insert(0, ".")
from agents.core.config import db

all_emps = db.table("profiles").select("employee_id,full_name,email").eq("role", "employee").execute().data
cases = db.table("exit_cases").select("employee_id").execute().data
case_emp_ids = {c["employee_id"] for c in cases}

clean = [e for e in all_emps if e["employee_id"] not in case_emp_ids]
print(f"Total employees: {len(all_emps)}, With cases: {len(case_emp_ids)}, Clean: {len(clean)}")
print("\nFirst 10 clean employees:")
for e in sorted(clean, key=lambda x: x["employee_id"] or "")[:10]:
    print(f"  {e['employee_id']:8} | {e['full_name']:20} | {e['email']}")

# Show Emp080/Emp081 case details
for eid in ["Emp080", "Emp081"]:
    case = db.table("exit_cases").select("id,status,stage,created_at").eq("employee_id", eid).execute().data
    if case:
        c = case[0]
        print(f"\n{eid} existing case: id={c['id'][:8]}... status={c['status']} stage={c.get('stage','?')} created={c['created_at'][:10]}")
