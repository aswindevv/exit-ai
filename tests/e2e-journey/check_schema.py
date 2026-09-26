"""Check actual exit_cases columns and Emp082/Emp083 eligibility."""
import sys
sys.path.insert(0, ".")
from agents.core.config import db

# Get one case to see actual columns
case = db.table("exit_cases").select("*").limit(1).execute().data
if case:
    print("exit_cases columns:", list(case[0].keys()))

# Check Emp082, Emp083 for clean state
for eid in ["Emp021", "Emp082", "Emp083"]:
    cases = db.table("exit_cases").select("id,status").eq("employee_id", eid).execute().data
    prof = db.table("profiles").select("email,full_name").eq("employee_id", eid).execute().data
    p = prof[0] if prof else {}
    print(f"{eid}: {p.get('full_name','?')} <{p.get('email','?')}> — cases: {len(cases)}")
