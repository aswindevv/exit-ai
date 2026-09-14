-- Expose exit_cases.created_at through manager_case_view and it_task_view so
-- the manager/IT dashboards can group each task list by employee and order
-- the groups by case creation (earliest first). Not an assessment field
-- (risk_level/risk_score/rehire_eligible/interview sentiment untouched) --
-- same safe posture as the other columns already on these views.
create or replace view public.manager_case_view
with (security_invoker = false) as
    select id,
           employee_name,
           department,
           role_title,
           last_working_day,
           created_at
    from public.exit_cases ec
    where manager_id = auth.uid();

create or replace view public.it_task_view
with (security_invoker = false) as
    select et.id,
           et.case_id,
           ec.employee_name,
           ec.department,
           et.title,
           et.status,
           et.due_date,
           ec.created_at
    from public.exit_tasks et
    join public.exit_cases ec on ec.id = et.case_id
    where et.stage = 'it' and app_current_role() = 'it';
