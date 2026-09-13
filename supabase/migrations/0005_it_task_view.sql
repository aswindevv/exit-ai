-- Recovers migration 0005 (already applied live, version 20260912080218,
-- but never committed as a file — the drift found in blueprint1.md D2).
-- IT-facing slice of exit_tasks: only stage='it' rows, self-filtered via
-- app_current_role() so non-IT roles get nothing back even with select grants.

create or replace view public.it_task_view
with (security_invoker = false) as
    select et.id,
           et.case_id,
           ec.employee_name,
           ec.department,
           et.title,
           et.status,
           et.due_date
    from public.exit_tasks et
    join public.exit_cases ec on ec.id = et.case_id
    where et.stage = 'it' and app_current_role() = 'it';

comment on view public.it_task_view is
    'IT-facing slice of exit_tasks: stage=it rows only, self-filtered by app_current_role(). Never add risk/rehire columns here.';

grant select on public.it_task_view to authenticated;
