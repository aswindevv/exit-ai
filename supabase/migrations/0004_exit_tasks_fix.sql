-- Fix two RLS gaps found during Phase 3 verification.
--
-- 1. manager_case_view / employee_exit_view had drifted to security_invoker=on
--    (opposite of 0002_rls.sql's intent), so they ran under the caller's role
--    and inherited exit_cases' HR-only RLS, returning zero rows to managers
--    and employees. Restore security_invoker=false so they run as the view
--    owner and expose only their own already-restricted column lists.
alter view public.manager_case_view set (security_invoker = false);
alter view public.employee_exit_view set (security_invoker = false);

-- 2. exit_tasks_manager_select / exit_tasks_employee_select check ownership via
--    an EXISTS subquery against exit_cases. That subquery runs under the same
--    calling role, and exit_cases only has an HR select policy - so the
--    subquery sees zero rows and the EXISTS is never true for a manager or
--    employee, even for their own tasks. Move the ownership check into a
--    SECURITY DEFINER helper (same pattern as app_current_role()) so it reads
--    exit_cases without going through exit_cases' own RLS.
create or replace function public.owns_exit_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.exit_cases ec
        join public.profiles p on p.employee_id = ec.employee_id
        where ec.id = p_case_id
          and (ec.manager_id = auth.uid() or p.id = auth.uid())
    );
$$;

drop policy if exists exit_tasks_manager_select on public.exit_tasks;
create policy exit_tasks_manager_select on public.exit_tasks
    for select
    using (public.owns_exit_case(case_id));

drop policy if exists exit_tasks_employee_select on public.exit_tasks;
create policy exit_tasks_employee_select on public.exit_tasks
    for select
    using (public.owns_exit_case(case_id));
