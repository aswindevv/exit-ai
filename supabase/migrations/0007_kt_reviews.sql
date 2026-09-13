-- ============================================================
-- 0007_kt_reviews.sql — Phase 6b: HR agent's (#2) KT-document review output.
--
-- exit_tasks carries ONE title field, shown verbatim on both the employee
-- checklist and the manager's KT approvals card (see EmployeeDashboard.jsx /
-- ManagerDashboard.jsx — both render exit_tasks.title as-is, no per-role
-- phrasing). So the evaluative finding ("gaps found in the handover doc, here
-- is why") cannot live in exit_tasks.title without leaking to the employee.
--
-- Split: exit_tasks keeps getting neutral, actionable titles (employee-safe,
-- e.g. "Add handover notes: <topic>") — same convention as every other seeded
-- task. The evaluative summary+gaps go here, HR/manager-only, same sensitivity
-- class as exit_interviews. Like the Phase 6a analytics narrative, this is
-- correctly persisted but not wired into ManagerDashboard.jsx's UI (that
-- would be a frontend change, out of scope) — flagged to the user.
-- ============================================================

create table if not exists kt_reviews (
    id         uuid primary key default gen_random_uuid(),
    case_id    uuid not null references exit_cases (id) on delete cascade,
    summary    text not null,
    gaps       jsonb not null default '[]'::jsonb,
    complete   boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_kt_reviews_case_id on kt_reviews (case_id);

alter table public.kt_reviews enable row level security;

drop policy if exists kt_reviews_hr_select on public.kt_reviews;
create policy kt_reviews_hr_select on public.kt_reviews
    for select to authenticated
    using (public.app_current_role() = 'hr');

drop policy if exists kt_reviews_manager_select on public.kt_reviews;
create policy kt_reviews_manager_select on public.kt_reviews
    for select to authenticated
    using (exists (
        select 1
        from public.exit_cases ec
        where ec.id = kt_reviews.case_id
          and ec.manager_id = auth.uid()
    ));
