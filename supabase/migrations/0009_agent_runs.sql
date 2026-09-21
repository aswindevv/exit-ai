-- ============================================================
-- 0009_agent_runs.sql — B2: persisted agent-run log for the HR dashboard's
-- "agent activity" view.
--
-- The terminal trace (agents/core/trace.py, B1) is stdout-only -- nothing to read
-- from the browser. This table gives the same hub/spoke stage transitions a
-- durable home: one row per supervisor stage (agents/hub/supervisor.py), reusing
-- the exact message it already builds for state["log"]. No separate LLM/DB
-- sub-step rows -- that granularity stays terminal-only, this is a
-- non-terminal user's "did the agents run for this case" feed.
-- ============================================================

create table if not exists agent_runs (
    id         uuid primary key default gen_random_uuid(),
    case_id    uuid not null references exit_cases (id) on delete cascade,
    stage      text not null,
    detail     text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_case_id on agent_runs (case_id);
create index if not exists idx_agent_runs_created_at on agent_runs (created_at desc);

alter table public.agent_runs enable row level security;

drop policy if exists agent_runs_hr_select on public.agent_runs;
create policy agent_runs_hr_select on public.agent_runs
    for select to authenticated
    using (public.app_current_role() = 'hr');
