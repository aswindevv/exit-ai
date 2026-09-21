-- Consolidated, idempotent fix for the recurring security_invoker drift bug
-- class (3rd occurrence: employee_exit_view, manager_case_view, it_task_view).
--
-- All five role-scoped views below are deliberately created with
-- security_invoker = false so they run AS THEIR OWNER and can see past
-- exit_cases'/exit_tasks'/exit_interviews' HR-only RLS policies, exposing
-- only their own already-restricted, safe (non-assessment) column lists.
-- That is the intended architecture, not a mistake.
--
-- Investigated and ruled out as the drift source: no migration or script in
-- this repo ever recreates these views without the WITH clause; no Postgres
-- event trigger touches view reloptions (rls_auto_enable only fires on
-- CREATE TABLE); pg_cron is not even installed on this project. The one
-- external match: Supabase's built-in Security Advisor flags every view
-- below as an ERROR-level "Security Definer View" finding, precisely
-- because security_invoker=false is what makes the pattern work -- applying
-- the Advisor's suggested remediation (security_invoker = on) is exactly
-- what breaks each dashboard. If this recurs again, someone (or some
-- process) is applying that "fix" from the Supabase dashboard.
--
-- DO NOT apply Supabase Advisor's "Security Definer View" fix to any of
-- these five views. If a dashboard reports 0 rows for a role that should
-- have data, re-run this migration first -- it's a safe, idempotent no-op
-- when nothing has drifted.
-- Each ALTER VIEW resets the flag to false in case Supabase tooling flipped it back to true.
-- Running this migration again is always safe — ALTER VIEW SET is idempotent.
alter view public.employee_exit_view            set (security_invoker = false); -- employee dashboard data
alter view public.manager_case_view              set (security_invoker = false); -- manager dashboard data
alter view public.it_task_view                   set (security_invoker = false); -- IT dashboard data
alter view public.finance_case_view              set (security_invoker = false); -- finance dashboard data
alter view public.employee_interview_status_view set (security_invoker = false); -- employee interview status
