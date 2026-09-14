-- Add relieving-letter fields to the employee-facing view.
--
-- The employee dashboard's new completion screen needs to know when HR has
-- issued the relieving letter (relieving_letter_issued, issued_at) and the
-- case's closing status. None of these are assessment data (risk_level,
-- risk_score, rehire_eligible, interview sentiment/summary) -- they're the
-- same posture as the existing safe columns, so they're safe to add to
-- employee_exit_view without touching RLS anywhere else.
create or replace view public.employee_exit_view
with (security_invoker = false) as
    select ec.id,
           ec.employee_name,
           ec.department,
           ec.role_title,
           ec.last_working_day,
           ec.status,
           ec.relieving_letter_issued,
           ec.issued_at
    from public.exit_cases ec
    join public.profiles p on p.employee_id = ec.employee_id
    where p.id = auth.uid();

comment on view public.employee_exit_view is
    'Employee-facing slice of exit_cases: safe columns only, self-filtered by auth.uid() via profiles.employee_id. status/relieving_letter_issued/issued_at added (0018) for the employee completion screen -- not assessment data. Never add risk/rehire columns here.';
