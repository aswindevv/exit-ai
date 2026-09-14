-- manager_case_view drifted back to security_invoker=on (same class of bug
-- 0004_exit_tasks_fix.sql fixed once, and 0009_employee_exit_view_fix fixed
-- again for employee_exit_view). With security_invoker=on it runs under the
-- caller's role, inheriting exit_cases' HR-only RLS policy, so every manager
-- got zero rows back for their own reports. Restore invoker=false so the
-- view runs as its owner and exposes only its own safe column list.
alter view public.manager_case_view set (security_invoker = false);
