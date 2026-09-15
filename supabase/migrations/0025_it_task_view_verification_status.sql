-- Phase 7 defect #1: IT dashboard shows "Done" from exit_tasks.status alone,
-- so a task the IT deprovisioning agent (#18) executed but failed to verify
-- (agent_runs.status='verification_failed') renders identical to a verified
-- one -- a false-success safety bug. Expose the latest verification outcome
-- so the frontend can tell them apart. Display only: no new writable state,
-- no risk/rehire columns (still HR-only), same security_invoker=false
-- posture as the other four role views (see 0020).
create or replace view public.it_task_view
with (security_invoker = false) as
    select et.id,
           et.case_id,
           ec.employee_name,
           ec.department,
           et.title,
           et.status,
           et.due_date,
           ec.created_at,
           ar.status as verification_status
    from public.exit_tasks et
    join public.exit_cases ec on ec.id = et.case_id
    left join lateral (
        select ar.status
        from public.agent_runs ar
        where ar.case_id = et.case_id
          and ar.stage = 'it_deprovisioning_execution'
          and ar.metadata ->> 'task_id' = et.id::text
        order by ar.created_at desc
        limit 1
    ) ar on true
    where et.stage = 'it' and app_current_role() = 'it';

comment on view public.it_task_view is
    'IT-facing slice of exit_tasks: stage=it rows only, self-filtered by app_current_role(). verification_status is the latest agent_runs outcome for that task''s execution (verified/verification_failed/null). Never add risk/rehire columns here.';

grant select on public.it_task_view to authenticated;
