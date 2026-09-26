"""Verify seeded cases are intact and DISP-002 is cleaned up."""
import sys
sys.path.insert(0, '.')
from agents.core.config import db

SEEDED_EMPS = ['Emp001', 'Emp005', 'Emp010', 'Emp025']
print('=== VERIFY SEEDED CASES INTACT ===')
ok = True
for eid in SEEDED_EMPS:
    cases = db.table('exit_cases').select('id,employee_name,status').eq('employee_id', eid).execute().data
    for c in cases:
        print(f"  {eid}: {c['employee_name']} | {c['status']} — OK")
    if not cases:
        print(f"  {eid}: NO CASE FOUND — MISSING!")
        ok = False

print()
print('=== DISP-002 CLEANUP VERIFY ===')
disp = db.table('exit_cases').select('id').eq('employee_id', 'DISP-002').execute().data
print(f"  DISP-002 cases: {len(disp)} (expect 0)")
if disp:
    ok = False

print()
print('SEEDED CASES:', 'ALL OK' if ok else 'PROBLEMS FOUND')
