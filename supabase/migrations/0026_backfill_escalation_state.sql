-- Phase 7 defect #2: agents/hub/supervisor.py's _escalate() (the CLI/graph path)
-- inserted escalation rows with escalation_state left NULL, so HR's
-- Re-route/Resolve UI (which filters on escalation_state) couldn't see them.
-- _escalate now sets 'open' on insert, matching service.reject_manager_task
-- (the UI path). Backfill any pre-existing rows created before that fix.
update public.exit_tasks
set escalation_state = 'open'
where title ilike 'Escalated%' and escalation_state is null;
