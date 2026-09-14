-- Employee "Mark done" control (browser test gap #4).
--
-- exit_tasks had SELECT policies for all four roles but no UPDATE policy for
-- employee, so the "My tasks" page was read-only -- same missing-policy gap
-- 0008_task_action_updates.sql fixed for manager/IT.
--
-- Scope: stage = 'hr' only. hr_agent's checklist generator produces two rows
-- per case -- stage 'hr' (employee's own pre-exit to-dos) and stage 'manager'
-- (KT items) -- but the manager, not the employee, marks the 'manager' row
-- done via their own approval button (0008's exit_tasks_manager_update,
-- "manager"/"finance" stages -- KT approval + clearance sign-off). 'it' is
-- cleared by IT, 'finance' by the manager's clearance sign-off, and
-- 'compliance' is a derived/automated row written by compliance_agent.py,
-- never manually toggled. So the only stage an employee genuinely completes
-- themselves is 'hr'.
--
-- Same approve-only shape as 0008: WITH CHECK pins status to 'done' (can't
-- un-complete), and the column-level grant (already applied by 0008, restated
-- here so this migration is self-contained) limits every authenticated role
-- to the status column only.
-- ------------------------------------------------------------
grant update (status) on public.exit_tasks to authenticated;

drop policy if exists exit_tasks_employee_update on public.exit_tasks;
create policy exit_tasks_employee_update on public.exit_tasks
    for update to authenticated
    using (
        public.app_current_role() = 'employee'
        and stage = 'hr'
        and public.owns_exit_case(case_id)
    )
    with check (
        public.app_current_role() = 'employee'
        and stage = 'hr'
        and public.owns_exit_case(case_id)
        and status = 'done'
    );
