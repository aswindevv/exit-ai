-- ============================================================
-- 0027_finance_reject_dues.sql — Finance Reject / Cannot clear.
--
-- Symmetric counterpart to finance_mark_dues_settled (0014): a
-- SECURITY DEFINER RPC, same reasons (exit_cases has no base SELECT policy
-- for finance -- see 0014's comment), that requires a reason and sets the
-- case to a finance-hold state instead of clearing it.
--
-- finance_rejected is a new column rather than overloading finance_cleared
-- alone: finance_cleared=false is also the untouched/"awaiting decision"
-- state, so a distinct flag is needed to tell "not yet actioned" apart from
-- "actioned, and Finance is holding it" (financeStatus.js reads this to
-- render "Held" instead of "Pending"). dues_note carries the reason -- it's
-- already exposed by finance_case_view and to HR's full exit_cases SELECT,
-- so no new grant/view surface is needed for either side to see it.
-- ============================================================

alter table public.exit_cases
    add column if not exists finance_rejected boolean not null default false;

-- Re-approving after a hold must release it -- finance_mark_dues_settled
-- stays forward-only on finance_cleared, but a hold is not "cleared" state
-- that needs the same protection.
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
    if public.app_current_role() <> 'finance' then
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

comment on function public.finance_reject_dues(uuid, text) is
    'Finance-only hold: security definer for the same reason as finance_mark_dues_settled (no base exit_cases SELECT policy for finance). Requires a non-empty reason, sets finance_cleared=false/finance_rejected=true/dues_note=reason, and writes an agent_runs audit row.';

grant execute on function public.finance_reject_dues(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- finance_case_view: add finance_rejected so Finance's own dashboard can
-- tell "not yet actioned" apart from "held". Same safe-columns-only view,
-- same security_invoker = false (CLAUDE.md non-negotiable -- do not change).
-- New column must be appended at the end -- Postgres refuses a
-- CREATE OR REPLACE VIEW that would rename/reorder any existing column.
-- ------------------------------------------------------------
create or replace view public.finance_case_view
with (security_invoker = false) as
    select ec.id,
           ec.employee_name,
           ec.department,
           ec.role_title,
           ec.last_working_day,
           ec.finance_cleared,
           ec.dues_note,
           ec.created_at,
           ec.finance_rejected
    from public.exit_cases ec
    where public.app_current_role() = 'finance';

comment on view public.finance_case_view is
    'Finance-facing slice of exit_cases: safe columns + finance_cleared/dues_note/created_at/finance_rejected only, self-filtered by app_current_role(). Never add risk/rehire columns here.';
