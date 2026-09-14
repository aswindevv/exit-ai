-- ============================================================
-- 0014_finance_dues_rpc.sql — fix the finance write path.
--
-- 0013's exit_cases_finance_update RLS policy never actually fires: exit_cases
-- has exactly one base-table SELECT policy (HR only, by design -- 0002_rls.sql
-- -- finance must NOT see risk_score/risk_level/rehire_eligible, and column
-- grants on exit_cases are wide open, so a base SELECT policy for finance
-- would leak those columns). Postgres requires a row to be visible under some
-- SELECT policy before an UPDATE's WHERE clause can even locate it -- so with
-- no SELECT policy, the finance UPDATE policy's USING clause never gets a
-- chance to run and every write silently matches zero rows.
--
-- Fix: a SECURITY DEFINER RPC (same bypass-RLS-but-self-check pattern as
-- app_current_role()) that does the row-visibility-free update directly,
-- checks the role itself, and only ever sets finance_cleared = true (forward
-- -only, same posture as the policy it replaces). Drop the now-dead policy
-- and grant so there's exactly one write path, not two.
-- ============================================================

drop policy if exists exit_cases_finance_update on public.exit_cases;
revoke update (finance_cleared, dues_note) on public.exit_cases from authenticated;

create or replace function public.finance_mark_dues_settled(p_case_id uuid, p_dues_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if public.app_current_role() <> 'finance' then
        raise exception 'not authorized';
    end if;

    update public.exit_cases
        set finance_cleared = true,
            dues_note = p_dues_note
        where id = p_case_id;
end;
$$;

comment on function public.finance_mark_dues_settled(uuid, text) is
    'Finance-only, forward-only clearance write: security definer so it does not need a base exit_cases SELECT policy (which would otherwise have to expose risk_score/risk_level/rehire_eligible to finance). Always sets finance_cleared = true; cannot un-clear a case.';

grant execute on function public.finance_mark_dues_settled(uuid, text) to authenticated;
