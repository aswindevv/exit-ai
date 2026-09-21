-- Manager dashboard fix: IT-owned work mis-filed as stage='manager'.
--
-- agents/spokes/hr_agent.py's checklist LLM occasionally wrote IT deprovisioning
-- items into 'manager_tasks' ("Revoke access to internal systems, servers,
-- and repositories"), so they were stored as stage='manager' and rendered on
-- the manager's KT approvals queue -- an item the manager cannot perform and
-- IT never sees. Worse, agents/service.py's manager_approve requires EVERY
-- manager-stage row to be done before it advances a case, so such a row holds
-- the manager->IT gate shut permanently.
--
-- hr_agent.IT_OWNED_TITLE_RE now stops new ones being written. This re-stages
-- the ones already in the table to 'it', where it_task_view (0025) exposes
-- them to the IT dashboard and the IT role can action them. Nothing is
-- deleted; only `stage` changes.
--
-- The EXISTS guard is the safety rail: a row is only moved on a case that
-- ALREADY has stage='it' rows. On a case still waiting at the manager gate,
-- creating the first 'it' row here would make it_agent.generate_plan's "it
-- tasks already exist" idempotency check skip the real deprovisioning plan.
--
-- Idempotent: re-running matches nothing new. To undo, flip 'it' back to
-- 'manager' for the same titles.
update public.exit_tasks et
set    stage = 'it'
where  et.stage = 'manager'
  and  et.title ~* '^\s*(revoke|de-?provision|disable|deactivate|terminate|remove)\y[^.]*\y(access|account|credential|login|sso|permission|licence|license|key)s?\y'
  and  exists (
           select 1 from public.exit_tasks other
           where  other.case_id = et.case_id
             and  other.stage = 'it'
       );
