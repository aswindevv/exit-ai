-- Issue relieving letter (HR action, final case-closing step).
--
-- HR has no write access to exit_cases at all today (only the
-- exit_cases_hr_select policy from 0002_rls.sql) -- add the one action HR
-- actually performs: issuing the relieving letter once every visible stage
-- (hr/manager/it/finance) is done AND finance has explicitly cleared the
-- case (finance_cleared, set by 0013's finance role). 'compliance' is
-- deliberately excluded from the gate -- it's an agent-only row with no
-- manual toggle anywhere in the UI (see agents/spokes/compliance_agent.py), so
-- gating on it would make this button permanently unreachable through any
-- role's UI, unlike e2e_automation.py's own internal completion check which
-- runs after the full agent pipeline.
--
-- Approve-only, one-shot, same posture as 0013's finance_cleared policy:
-- WITH CHECK pins relieving_letter_issued to true and issued_by to the
-- caller, and USING requires the case not already be issued -- so this
-- surface can only flip a case from not-issued to issued once, never back,
-- never under someone else's name. Issuing also closes the case
-- (status -> 'completed'), since nothing else in the RLS-gated frontend
-- surface currently can.
alter table public.exit_cases
    add column if not exists relieving_letter_issued boolean not null default false,
    add column if not exists issued_at timestamptz,
    add column if not exists issued_by uuid references public.profiles(id);

-- SECURITY DEFINER (same pattern as owns_exit_case(), 0004) so it can read
-- exit_tasks regardless of the caller's own row-level visibility -- this is
-- a derived boolean, not new data exposure.
create or replace function public.exit_case_cleared_for_relieving(p_case_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select coalesce(
        (select finance_cleared from public.exit_cases where id = p_case_id),
        false
    )
    and not exists (
        select 1 from public.exit_tasks
        where case_id = p_case_id
          and stage in ('hr', 'manager', 'it', 'finance')
          and status <> 'done'
    )
    and (
        select count(distinct stage) from public.exit_tasks
        where case_id = p_case_id
          and stage in ('hr', 'manager', 'it', 'finance')
    ) = 4;
$$;

revoke all on function public.exit_case_cleared_for_relieving(uuid) from public;
grant execute on function public.exit_case_cleared_for_relieving(uuid) to authenticated;

grant update (relieving_letter_issued, issued_at, issued_by, status) on public.exit_cases to authenticated;

drop policy if exists exit_cases_hr_relieving_letter on public.exit_cases;
create policy exit_cases_hr_relieving_letter on public.exit_cases
    for update to authenticated
    using (
        public.app_current_role() = 'hr'
        and relieving_letter_issued = false
    )
    with check (
        public.app_current_role() = 'hr'
        and relieving_letter_issued = true
        and issued_by = auth.uid()
        and status = 'completed'
        and public.exit_case_cleared_for_relieving(id)
    );
