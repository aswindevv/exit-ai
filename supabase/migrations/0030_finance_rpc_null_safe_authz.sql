-- ============================================================
-- 0030_finance_rpc_null_safe_authz.sql — SECURITY FIX.
--
-- Defect: an UNAUTHENTICATED caller holding only the browser's anon key could
-- call finance_mark_dues_settled / finance_reject_dues on any case id and flip
-- finance_cleared / finance_rejected / dues_note. Proven against the live
-- project: the call returned with no error and no 'not authorized' exception.
--
-- Two independent causes, both fixed here:
--
--   1. NULL-vs-<> comparison. For a caller with no JWT, auth.uid() is NULL, so
--      public.app_current_role() returns NULL. The guard read
--          if public.app_current_role() <> 'finance' then raise ...
--      and `NULL <> 'finance'` evaluates to NULL, which is not TRUE, so the
--      IF branch never fired and execution fell through to the UPDATE.
--      Fixed with `is distinct from`, which is NULL-safe and returns TRUE here.
--
--   2. Missing REVOKE. Postgres grants EXECUTE on a new function to PUBLIC by
--      default. 0014 and 0027 only added `grant execute ... to authenticated`
--      and never revoked the default, so anon retained EXECUTE. 0002 and 0017
--      already establish the correct pattern in this project
--      (`revoke all on function ... from public` before the grant) — this file
--      applies that same pattern to the two finance write functions, and also
--      revokes from anon explicitly in case a blanket default-privileges grant
--      handed anon its own grant independently of PUBLIC.
--
-- Behaviour intentionally UNCHANGED for legitimate callers: finance still
-- clears/holds exactly as before, the reason is still required, the audit row
-- is still written, and both functions remain SECURITY DEFINER with an empty
-- search_path (they must stay definer — exit_cases deliberately has no base
-- SELECT policy for finance, so a plain UPDATE policy would match zero rows).
-- ============================================================

create or replace function public.finance_mark_dues_settled(p_case_id uuid, p_dues_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- NULL-safe: an unauthenticated caller (role NULL) is rejected here.
    if public.app_current_role() is distinct from 'finance' then
        raise exception 'not authorized';
    end if;

    update public.exit_cases
        set finance_cleared = true,
            finance_rejected = false,
            dues_note = p_dues_note
        where id = p_case_id;
end;
$$;

create or replace function public.finance_reject_dues(p_case_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- NULL-safe: an unauthenticated caller (role NULL) is rejected here.
    if public.app_current_role() is distinct from 'finance' then
        raise exception 'not authorized';
    end if;

    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'reason required';
    end if;

    update public.exit_cases
        set finance_cleared = false,
            finance_rejected = true,
            dues_note = p_reason
        where id = p_case_id;

    insert into public.agent_runs (case_id, stage, agent, status, detail)
        values (p_case_id, 'finance', 'finance_reject', 'rejected', p_reason);
end;
$$;

-- Close the default PUBLIC grant (cause 2), then re-grant only to signed-in
-- users. anon is revoked explicitly as well: CREATE OR REPLACE preserves
-- existing grants, so a grant anon may already hold is not removed by the
-- PUBLIC revoke alone.
revoke all on function public.finance_mark_dues_settled(uuid, text) from public;
revoke all on function public.finance_mark_dues_settled(uuid, text) from anon;
revoke all on function public.finance_reject_dues(uuid, text)       from public;
revoke all on function public.finance_reject_dues(uuid, text)       from anon;

grant execute on function public.finance_mark_dues_settled(uuid, text) to authenticated;
grant execute on function public.finance_reject_dues(uuid, text)       to authenticated;

comment on function public.finance_mark_dues_settled(uuid, text) is
    'Finance-only, forward-only clearance write. SECURITY DEFINER because exit_cases has no base SELECT policy for finance (that is what keeps risk_score/risk_level/rehire_eligible hidden) and Postgres cannot apply an UPDATE WHERE clause to a row the caller cannot see. Authorization is NULL-safe (is distinct from) and EXECUTE is revoked from public/anon — see 0030.';

comment on function public.finance_reject_dues(uuid, text) is
    'Finance-only hold. Same definer/authorization posture as finance_mark_dues_settled: NULL-safe role check, EXECUTE revoked from public/anon (0030). Requires a non-empty reason and writes an agent_runs audit row.';
