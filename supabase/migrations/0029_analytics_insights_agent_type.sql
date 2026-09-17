-- analytics_insights.agent_type — the discriminator that tells the four
-- analytics-family agents' rows apart:
--
--   dashboard_insights          #14  analytics_agent.py
--   workflow_optimizer          #17  workflow_optimizer.py
--   policy_compliance_auditor   #22  policy_auditor.py   <- the Policy Audit page
--   predictive_attrition        #23  attrition_agent.py
--
-- Drift fix, not a new feature: all four agents have been writing this column
-- and HrLayout.jsx has been filtering on it since Phase 6b, but 0006 never
-- declared it -- it was added straight to the live table, so a fresh database
-- rebuilt from migrations alone would have failed on every insert. This makes
-- the migrations the source of truth again. Backward-compatible and
-- idempotent: nullable, no default, existing rows keep their values.
alter table public.analytics_insights
    add column if not exists agent_type text;

comment on column public.analytics_insights.agent_type is
    'Which analytics-family agent wrote this row: dashboard_insights (#14), workflow_optimizer (#17), policy_compliance_auditor (#22), predictive_attrition (#23). Always set by the agent; nullable only so the column could be added without rewriting history.';

-- Every consumer asks the same question: the newest row for one agent_type.
create index if not exists idx_analytics_insights_agent_type_created_at
    on public.analytics_insights (agent_type, created_at desc);

-- RLS is unchanged: analytics_insights_hr_select (0006) already restricts the
-- whole table to app_current_role() = 'hr', which is what the Policy Audit
-- page relies on. No new policy, no new grant.
