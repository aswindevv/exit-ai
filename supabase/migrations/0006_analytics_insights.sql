-- ============================================================
-- 0006_analytics_insights.sql — Phase 6a: storage for the Analytics agent's
-- (#9) narratives. Aggregation is done in Python (exit_cases/exit_tasks
-- counts); this table stores only the LLM's narrative + the stats it was
-- given, for the HR "insights" panel. HR-only, same sensitivity class as
-- trend_alerts.
-- ============================================================

create table if not exists analytics_insights (
    id         uuid primary key default gen_random_uuid(),
    narrative  text not null,
    stats      jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_analytics_insights_created_at
    on analytics_insights (created_at desc);

alter table public.analytics_insights enable row level security;

drop policy if exists analytics_insights_hr_select on public.analytics_insights;
create policy analytics_insights_hr_select on public.analytics_insights
    for select to authenticated
    using (public.app_current_role() = 'hr');
