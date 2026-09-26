"""Part 6 cleanup: delete test data for Emp080-083, verify seeded cases intact."""
import sys
sys.path.insert(0, '.')
from agents.core.config import db

TEST_EMPS = ['Emp080', 'Emp081', 'Emp082', 'Emp083']
SEEDED_EMPS = ['Emp001', 'Emp005', 'Emp010', 'Emp025']

print('=== TEST CASES (to delete) ===')
test_case_ids = []
for eid in TEST_EMPS:
    cases = db.table('exit_cases').select('id,employee_name,status').eq('employee_id', eid).execute().data
    for c in cases:
        print(f'  {eid}: id={c["id"]} | {c["employee_name"]} | {c["status"]}')
        test_case_ids.append(c['id'])
    if not cases:
        print(f'  {eid}: no cases')

print(f'\nTotal test cases to delete: {len(test_case_ids)}')

# Delete dependent records first (exit_interviews, exit_tasks, exit_documents, agent_runs)
for cid in test_case_ids:
    # exit_interviews
    r = db.table('exit_interviews').delete().eq('case_id', cid).execute()
    print(f'  Deleted interviews for {cid[:8]}: {len(r.data)} rows')
    # exit_tasks
    r = db.table('exit_tasks').delete().eq('case_id', cid).execute()
    print(f'  Deleted tasks for {cid[:8]}: {len(r.data)} rows')
    # exit_documents
    try:
        r = db.table('exit_documents').delete().eq('case_id', cid).execute()
        print(f'  Deleted documents for {cid[:8]}: {len(r.data)} rows')
    except Exception as e:
        print(f'  exit_documents skip: {e}')
    # agent_runs
    try:
        r = db.table('agent_runs').delete().eq('case_id', cid).execute()
        print(f'  Deleted agent_runs for {cid[:8]}: {len(r.data)} rows')
    except Exception as e:
        print(f'  agent_runs skip: {e}')
    # kt_items
    try:
        r = db.table('kt_items').delete().eq('case_id', cid).execute()
        print(f'  Deleted kt_items for {cid[:8]}: {len(r.data)} rows')
    except Exception as e:
        print(f'  kt_items skip: {e}')

# Delete the exit cases themselves
for cid in test_case_ids:
    r = db.table('exit_cases').delete().eq('id', cid).execute()
    print(f'  Deleted exit_case {cid[:8]}: {len(r.data)} rows')

print('\n=== VERIFY TEST CASES GONE ===')
for eid in TEST_EMPS:
    cases = db.table('exit_cases').select('id').eq('employee_id', eid).execute().data
    print(f'  {eid}: {len(cases)} cases remaining')

print('\n=== VERIFY SEEDED CASES INTACT ===')
for eid in SEEDED_EMPS:
    cases = db.table('exit_cases').select('id,employee_name,status').eq('employee_id', eid).execute().data
    for c in cases:
        print(f'  {eid}: {c["employee_name"]} | {c["status"]} — OK')
    if not cases:
        print(f'  {eid}: NO CASE FOUND — MISSING!')

print('\nCleanup complete.')
