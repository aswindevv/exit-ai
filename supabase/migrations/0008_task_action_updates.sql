-- Frontend action-button wiring (Manager "Review"/"Sign", IT "Approve").
--
-- 0002_rls.sql gave exit_tasks SELECT policies for all four roles but no
-- UPDATE policy at all, for any role. With RLS enabled and no matching
-- policy, every update was silently denied -- which is exactly why the
-- dashboard buttons were still no-ops even though the tables and data were
-- real. This adds the minimum UPDATE surface each button needs, scoped the
-- same way the existing SELECT policies are:
--   - Manager: only their own reports' (owns_exit_case) 'manager'/'finance'
--     stage tasks -- KT approval and clearance sign-off.
--   - IT: only 'it' stage tasks (same scope as exit_tasks_it_select).
--
-- Both are approve-only: the WITH CHECK pins status to 'done', so this
-- surface can't be used to un-approve or otherwise repurpose the column.
-- Column-level grant restricts every authenticated role to the status column
-- only, so even a crafted request can't rewrite title/case_id/due_date etc.
-- ------------------------------------------------------------
grant update (status) on public.exit_tasks to authenticated;

drop policy if exists exit_tasks_manager_update on public.exit_tasks;
create policy exit_tasks_manager_update on public.exit_tasks
    for update to authenticated
    using (
        public.app_current_role() = 'manager'
        and stage in ('manager', 'finance')
        and public.owns_exit_case(case_id)
    )
    with check (
        public.app_current_role() = 'manager'
        and stage in ('manager', 'finance')
        and public.owns_exit_case(case_id)
        and status = 'done'
    );

drop policy if exists exit_tasks_it_update on public.exit_tasks;
create policy exit_tasks_it_update on public.exit_tasks
    for update to authenticated
    using (
        public.app_current_role() = 'it'
        and stage = 'it'
    )
    with check (
        public.app_current_role() = 'it'
        and stage = 'it'
        and status = 'done'
    );
