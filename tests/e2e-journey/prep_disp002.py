"""Pre-test cleanup: delete all exit data for DISP-002 so the browser pipeline
starts from a truly fresh state. Safe to run multiple times (idempotent).
Run: python tests/e2e-journey/prep_disp002.py
"""
import sys
sys.path.insert(0, '.')
from agents.core.config import db

EMP_ID = 'DISP-002'

print(f'=== Pre-test cleanup for {EMP_ID} ===')
cases = db.table('exit_cases').select('id,employee_name,status').eq('employee_id', EMP_ID).execute().data

if not cases:
    print(f'  No exit_case found for {EMP_ID} — ready for fresh test.')
else:
    for c in cases:
        cid = c['id']
        print(f'  Found case: {cid[:8]} | {c["employee_name"]} | {c["status"]}')

        for tbl in ('exit_interviews', 'exit_tasks', 'case_documents', 'agent_runs', 'kt_reviews'):
            try:
                r = db.table(tbl).delete().eq('case_id', cid).execute()
                print(f'    Deleted {tbl}: {len(r.data)} rows')
            except Exception as e:
                print(f'    {tbl} skip: {e}')

        db.table('exit_cases').delete().eq('id', cid).execute()
        print(f'    Deleted exit_case {cid[:8]}')

    # Verify
    remaining = db.table('exit_cases').select('id').eq('employee_id', EMP_ID).execute().data
    if remaining:
        print(f'  ERROR: {len(remaining)} cases still remain for {EMP_ID}!')
        sys.exit(1)

print(f'\n  {EMP_ID} is clean — run the browser test now.')
