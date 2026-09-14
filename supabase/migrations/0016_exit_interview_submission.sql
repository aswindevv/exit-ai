-- Employee exit-interview submission (Task 2 / browser-gap #6).
--
-- exit_interviews had columns for the AGENT's analysis output only
-- (summary/sentiment/themes/rehire_*) -- nowhere to store what the employee
-- actually typed. Add the raw-input columns here. Same shape as exit_cases.
-- resignation_reason: free-text employee input is not itself assessment
-- data, so it can live on the same row as the HR-only analysis columns as
-- long as SELECT stays HR-only (unchanged below) and employees can only
-- ever INSERT, never read back.
alter table public.exit_interviews
    add column if not exists reason_for_leaving text,
    add column if not exists feedback           text,
    add column if not exists would_recommend     boolean,
    add column if not exists comments            text;

-- One interview per case -- matches exit_intel_agent._persist, which already
-- treats case_id as a natural key (update-if-exists, else insert).
alter table public.exit_interviews
    add constraint exit_interviews_case_id_key unique (case_id);

-- Column-level grant: employees may only ever INSERT the raw fields, never
-- the analysis columns -- same belt-and-suspenders shape as 0008/0013/0015
-- (grant restricts columns, RLS policy restricts rows).
grant insert (case_id, reason_for_leaving, feedback, would_recommend, comments)
    on public.exit_interviews to authenticated;

-- owns_exit_case() (0004) ORs manager-or-employee, but pairing it with
-- app_current_role() = 'employee' already filters out managers (their role
-- is 'manager', never 'employee') -- identical shape to 0015's
-- exit_tasks_employee_update.
drop policy if exists exit_interviews_employee_insert on public.exit_interviews;
create policy exit_interviews_employee_insert on public.exit_interviews
    for insert to authenticated
    with check (
        public.app_current_role() = 'employee'
        and public.owns_exit_case(case_id)
    );

-- Lets the employee's own page know "already submitted" across reloads
-- without ever exposing summary/sentiment/themes/rehire_* -- same
-- restricted-view shape as employee_exit_view (0002): security_invoker =
-- false so it can see past exit_interviews' HR-only SELECT policy, self-
-- filtered to the caller's own case via the same profiles/exit_cases join.
create or replace view public.employee_interview_status_view
with (security_invoker = false) as
    select ei.case_id,
           ei.created_at
    from public.exit_interviews ei
    join public.exit_cases ec on ec.id = ei.case_id
    join public.profiles p on p.employee_id = ec.employee_id
    where p.id = auth.uid();

comment on view public.employee_interview_status_view is
    'Employee-facing "have I submitted yet" check: case_id/created_at only. Never add summary/sentiment/themes/rehire_* here.';

grant select on public.employee_interview_status_view to authenticated;
