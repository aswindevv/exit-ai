-- ============================================================
-- 0002_rls.sql — the access-control model, as runnable SQL.
--
-- Implements the CLAUDE.md non-negotiable: "Assessment fields are HR-only.
-- risk_level, risk_score, rehire_eligible and any exit-interview
-- sentiment/summary must NOT be exposed to Employee, Manager, or IT - not in
-- their queries, not in any view they can read. Enforced in the database
-- (RLS + restricted views), not just hidden in the UI."
--
-- The mechanism: exit_cases has exactly ONE policy (HR). Managers and
-- employees get no policy on the base table at all, so they read 0 rows from
-- it no matter what columns they ask for. Their only path in is a
-- security-definer view that selects a fixed safe column list.
-- ============================================================

-- ------------------------------------------------------------
-- Role helper.
--
-- security definer so it can read profiles while profiles itself is under
-- RLS. `set search_path = ''` and fully-qualified table names: with an empty
-- search_path an attacker cannot shadow `profiles` or `uid` with an object in
-- a schema they control and have this definer function resolve to it.
-- ------------------------------------------------------------
create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select p.role
    from public.profiles p
    where p.id = auth.uid();
$$;

comment on function public.app_current_role() is
    'Returns profiles.role for the calling auth user. security definer + empty search_path so RLS policies can call it without granting read access to profiles.';

revoke all on function public.app_current_role() from public;
grant execute on function public.app_current_role() to authenticated;

-- ------------------------------------------------------------
-- RLS on every table. Default-deny: a table with RLS on and no matching
-- policy returns 0 rows and rejects writes.
-- ------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.exit_cases      enable row level security;
alter table public.exit_tasks      enable row level security;
alter table public.exit_interviews enable row level security;
alter table public.trend_alerts    enable row level security;
alter table public.exit_docs       enable row level security;

-- ------------------------------------------------------------
-- profiles: you can read your own row (the frontend needs it to know which
-- dashboard to render). HR can read all, to build case assignments.
-- ------------------------------------------------------------
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
    for select to authenticated
    using (id = auth.uid());

drop policy if exists profiles_hr_select on public.profiles;
create policy profiles_hr_select on public.profiles
    for select to authenticated
    using (public.app_current_role() = 'hr');

-- ------------------------------------------------------------
-- exit_cases: ONE policy. HR only. No employee policy, no manager policy.
--
-- Do not add one. Employees and managers reach their cases through
-- employee_exit_view / manager_case_view below, which cannot return the
-- assessment columns. A policy here would hand them the whole row.
-- ------------------------------------------------------------
drop policy if exists exit_cases_hr_select on public.exit_cases;
create policy exit_cases_hr_select on public.exit_cases
    for select to authenticated
    using (public.app_current_role() = 'hr');

-- ------------------------------------------------------------
-- Restricted views.
--
-- security_invoker = false (the default, stated explicitly) makes these run
-- as the view owner, so they see past exit_cases' HR-only policy. That is the
-- whole point: the view owner can read the table, and the view's SELECT list
-- decides what the caller gets. The safe column list is:
--     id, employee_name, department, role_title, last_working_day
-- NEVER add risk_level, risk_score or rehire_eligible to either view.
--
-- Each view self-filters on auth.uid(), so a caller only sees their own rows
-- even though the view itself is unrestricted.
-- ------------------------------------------------------------
create or replace view public.employee_exit_view
with (security_invoker = false) as
    select ec.id,
           ec.employee_name,
           ec.department,
           ec.role_title,
           ec.last_working_day
    from public.exit_cases ec
    join public.profiles p on p.employee_id = ec.employee_id
    where p.id = auth.uid();

comment on view public.employee_exit_view is
    'Employee-facing slice of exit_cases: safe columns only, self-filtered by auth.uid() via profiles.employee_id. Never add risk/rehire columns here.';

create or replace view public.manager_case_view
with (security_invoker = false) as
    select ec.id,
           ec.employee_name,
           ec.department,
           ec.role_title,
           ec.last_working_day
    from public.exit_cases ec
    where ec.manager_id = auth.uid();

comment on view public.manager_case_view is
    'Manager-facing slice of exit_cases: safe columns only, self-filtered to the caller own reports via manager_id. Never add risk/rehire columns here.';

grant select on public.employee_exit_view to authenticated;
grant select on public.manager_case_view  to authenticated;

-- ------------------------------------------------------------
-- exit_tasks: the checklist is not sensitive, so all four roles get a policy
-- here, each scoped to what they are responsible for.
-- ------------------------------------------------------------
drop policy if exists exit_tasks_hr_select on public.exit_tasks;
create policy exit_tasks_hr_select on public.exit_tasks
    for select to authenticated
    using (public.app_current_role() = 'hr');

drop policy if exists exit_tasks_it_select on public.exit_tasks;
create policy exit_tasks_it_select on public.exit_tasks
    for select to authenticated
    using (public.app_current_role() = 'it' and stage = 'it');

drop policy if exists exit_tasks_employee_select on public.exit_tasks;
create policy exit_tasks_employee_select on public.exit_tasks
    for select to authenticated
    using (exists (
        select 1
        from public.exit_cases ec
        join public.profiles p on p.employee_id = ec.employee_id
        where ec.id = exit_tasks.case_id
          and p.id = auth.uid()
    ));

drop policy if exists exit_tasks_manager_select on public.exit_tasks;
create policy exit_tasks_manager_select on public.exit_tasks
    for select to authenticated
    using (exists (
        select 1
        from public.exit_cases ec
        where ec.id = exit_tasks.case_id
          and ec.manager_id = auth.uid()
    ));

-- ------------------------------------------------------------
-- exit_interviews and trend_alerts: HR only. Interview summary/sentiment and
-- attrition trends are assessment data.
-- ------------------------------------------------------------
drop policy if exists exit_interviews_hr_select on public.exit_interviews;
create policy exit_interviews_hr_select on public.exit_interviews
    for select to authenticated
    using (public.app_current_role() = 'hr');

drop policy if exists trend_alerts_hr_select on public.trend_alerts;
create policy trend_alerts_hr_select on public.trend_alerts
    for select to authenticated
    using (public.app_current_role() = 'hr');

-- ------------------------------------------------------------
-- exit_docs: RLS is ON and there is DELIBERATELY NO POLICY for anon or
-- authenticated. Not an oversight — do not add one.
--
-- This is what makes /ask the only path to the policy documents. The frontend
-- holds the anon key, so with no policy it reads 0 rows from exit_docs and
-- cannot query the corpus directly. The /ask Edge Function uses the
-- service-role key, which bypasses RLS, so retrieval still works — but every
-- request goes through /ask, where the question and the returned chunks can
-- be logged, rate-limited and redacted. Without this, /ask would be a
-- convenience wrapper around a table the browser could already read, not a
-- security boundary.
--
-- match_exit_docs (0003_rag.sql) is intentionally NOT security definer, so it
-- inherits the caller's RLS and cannot be used to step around this.
-- ------------------------------------------------------------
comment on table public.exit_docs is
    'RAG chunk store. RLS enabled with NO anon/authenticated policy on purpose: the frontend must go through the service-key /ask Edge Function, which is therefore a real boundary and not just a wrapper. Do not add a select policy here.';
