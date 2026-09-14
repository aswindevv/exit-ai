-- ============================================================
-- 0013_finance_role.sql — Finance clearance role.
--
-- Adds 'finance' as a real profiles.role value (was employee/hr/manager/it
-- only), adds the two exit_cases columns finance_agent.py now gates on
-- (finance_cleared, dues_note), and gives 'finance' the same restricted-view
-- + task-visibility pattern already used for manager/IT (0002_rls.sql /
-- 0005_it_task_view.sql / 0008_task_action_updates.sql) -- never grants
-- access to exit_cases' HR-only assessment columns (risk_level, risk_score,
-- rehire_eligible) or exit_interviews.
-- ============================================================

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
    check (role in ('employee', 'hr', 'manager', 'it', 'finance'));

alter table public.exit_cases
    add column if not exists finance_cleared boolean not null default false,
    add column if not exists dues_note text;

-- ------------------------------------------------------------
-- exit_tasks: finance needs every stage's status (hr/manager/it/finance) to
-- know what's still pending on a case -- same "checklist isn't sensitive"
-- reasoning as the existing hr/it/manager/employee policies.
-- ------------------------------------------------------------
drop policy if exists exit_tasks_finance_select on public.exit_tasks;
create policy exit_tasks_finance_select on public.exit_tasks
    for select to authenticated
    using (public.app_current_role() = 'finance');

-- ------------------------------------------------------------
-- exit_cases: finance may flip finance_cleared / write dues_note for any
-- case -- but only forward (approve-only, same posture as the manager/IT
-- update policies in 0008): the WITH CHECK pins finance_cleared to true, so
-- this surface can't be used to un-clear a case. Column-level grant limits
-- every authenticated role to exactly these two columns.
-- ------------------------------------------------------------
grant update (finance_cleared, dues_note) on public.exit_cases to authenticated;

drop policy if exists exit_cases_finance_update on public.exit_cases;
create policy exit_cases_finance_update on public.exit_cases
    for update to authenticated
    using (public.app_current_role() = 'finance')
    with check (public.app_current_role() = 'finance' and finance_cleared = true);

-- ------------------------------------------------------------
-- finance_case_view: finance-facing slice of exit_cases. Safe columns only
-- (+ finance_cleared, dues_note -- both new, neither is assessment data) --
-- NEVER add risk_level, risk_score or rehire_eligible here.
-- ------------------------------------------------------------
create or replace view public.finance_case_view
with (security_invoker = false) as
    select ec.id,
           ec.employee_name,
           ec.department,
           ec.role_title,
           ec.last_working_day,
           ec.finance_cleared,
           ec.dues_note
    from public.exit_cases ec
    where public.app_current_role() = 'finance';

comment on view public.finance_case_view is
    'Finance-facing slice of exit_cases: safe columns + finance_cleared/dues_note only, self-filtered by app_current_role(). Never add risk/rehire columns here.';

grant select on public.finance_case_view to authenticated;
