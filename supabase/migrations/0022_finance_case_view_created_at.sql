-- Expose exit_cases.created_at through finance_case_view so the Finance
-- dashboard can group its case list by employee and order the groups by
-- case creation (earliest first), matching manager_case_view/it_task_view
-- (0021). Not an assessment field -- same safe posture as the other columns
-- already on this view.
create or replace view public.finance_case_view
with (security_invoker = false) as
    select ec.id,
           ec.employee_name,
           ec.department,
           ec.role_title,
           ec.last_working_day,
           ec.finance_cleared,
           ec.dues_note,
           ec.created_at
    from public.exit_cases ec
    where public.app_current_role() = 'finance';

comment on view public.finance_case_view is
    'Finance-facing slice of exit_cases: safe columns + finance_cleared/dues_note/created_at only, self-filtered by app_current_role(). Never add risk/rehire columns here.';
