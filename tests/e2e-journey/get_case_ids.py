"""Get case IDs for agent testing."""
import sys
sys.path.insert(0, ".")
from agents.core.config import db

# Emp081's existing case (from previous test run, not original seed)
emp081 = db.table("exit_cases").select("id,employee_id,employee_name,status").eq("employee_id", "Emp081").execute().data
print("=== Emp081 case ===")
for c in emp081:
    print(f"  id={c['id']} status={c['status']} name={c['employee_name']}")

# First few seeded cases for comparison
seeded = db.table("exit_cases").select("id,employee_id,status").in_("employee_id", ["Emp001","Emp002","Emp003"]).execute().data
print("\n=== Original seeded cases ===")
for c in seeded:
    print(f"  {c['employee_id']}: id={c['id'][:8]}... status={c['status']}")
