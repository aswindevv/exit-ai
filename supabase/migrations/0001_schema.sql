-- ============================================================
-- 0001_schema.sql — ExitAI base schema.
--
-- Consolidates: root schema.sql (exit_docs + pgvector) and the table
-- definitions described in blueprint.md Phase 2. Security lives in
-- 0002_rls.sql; the RAG search function lives in 0003_rag.sql.
--
-- NOTE: blueprint.md referred to `dashboards/schema.sql` and `rag/schema.sql`,
-- which never existed. Only a root `schema.sql` did; it supplied exit_docs +
-- match_exit_docs and has since been deleted, its contents absorbed here and
-- into 0003_rag.sql. These migrations are the only source of truth for the
-- schema. The five dashboard tables below are authored from blueprint.md prose
-- (Phase 2 seed spec, Phase 4 queries, Phase 6a agent write targets, Phase 8
-- KT event id).
-- ============================================================

create extension if not exists vector;

-- ------------------------------------------------------------
-- profiles — one row per auth user. `role` drives every RLS policy.
-- id matches auth.users.id so auth.uid() joins directly.
-- ------------------------------------------------------------
create table if not exists profiles (
    id          uuid primary key references auth.users (id) on delete cascade,
    role        text not null check (role in ('employee', 'hr', 'manager', 'it')),
    full_name   text not null,
    email       text not null unique,
    employee_id text unique,          -- e.g. 'Emp001'; null for HR/Manager/IT staff
    department  text,
    created_at  timestamptz not null default now()
);

create index if not exists idx_profiles_role        on profiles (role);
create index if not exists idx_profiles_employee_id on profiles (employee_id);

-- ------------------------------------------------------------
-- exit_cases — one row per offboarding.
--
-- risk_level, risk_score and rehire_eligible are HR-ONLY (CLAUDE.md
-- non-negotiable). They live here and are never exposed through the
-- manager/employee views in 0002_rls.sql.
-- ------------------------------------------------------------
create table if not exists exit_cases (
    id               uuid primary key default gen_random_uuid(),
    employee_id      text not null references profiles (employee_id),
    employee_name    text not null,
    email            text not null,
    department       text not null,
    role_title       text not null,
    manager_id       uuid references profiles (id),
    hr_id            uuid references profiles (id),
    last_working_day date not null,
    status           text not null default 'open' check (status in ('open', 'in_progress', 'completed')),
    -- HR-only assessment columns below this line.
    risk_level       text check (risk_level in ('low', 'medium', 'high')),
    risk_score       numeric,
    rehire_eligible  boolean,
    created_at       timestamptz not null default now()
);

create index if not exists idx_exit_cases_employee_id on exit_cases (employee_id);
create index if not exists idx_exit_cases_manager_id  on exit_cases (manager_id);
create index if not exists idx_exit_cases_status      on exit_cases (status);

-- ------------------------------------------------------------
-- exit_tasks — checklist items. `stage` routes a task to a dashboard
-- ('it' -> IT dashboard, 'finance' -> HR, etc). kt_event_id is written by
-- Phase 8 when a KT meeting is booked.
-- ------------------------------------------------------------
create table if not exists exit_tasks (
    id          uuid primary key default gen_random_uuid(),
    case_id     uuid not null references exit_cases (id) on delete cascade,
    stage       text not null,
    title       text not null,
    status      text not null default 'pending' check (status in ('pending', 'done')),
    due_date    date,
    kt_event_id text,
    created_at  timestamptz not null default now()
);

create index if not exists idx_exit_tasks_case_id on exit_tasks (case_id);
create index if not exists idx_exit_tasks_stage   on exit_tasks (stage);

-- ------------------------------------------------------------
-- exit_interviews — HR-only. summary/sentiment/themes are assessment data.
-- ------------------------------------------------------------
create table if not exists exit_interviews (
    id              uuid primary key default gen_random_uuid(),
    case_id         uuid not null references exit_cases (id) on delete cascade,
    summary         text,
    sentiment       text,
    themes          jsonb not null default '[]'::jsonb,
    rehire_eligible boolean,
    rehire_reason   text,
    created_at      timestamptz not null default now()
);

create index if not exists idx_exit_interviews_case_id on exit_interviews (case_id);

-- ------------------------------------------------------------
-- trend_alerts — HR-only. Rising attrition themes.
-- ------------------------------------------------------------
create table if not exists trend_alerts (
    id         uuid primary key default gen_random_uuid(),
    theme      text not null,
    department text,
    severity   text not null check (severity in ('low', 'medium', 'high')),
    detail     text,
    created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- exit_docs — RAG store. One row per CHUNK, not per document.
--
-- embedding is 1536-dim because we use OpenAI text-embedding-3-small. If you
-- switch embedding models, change this number to match, or every insert will
-- fail on a dimension mismatch.
-- ------------------------------------------------------------
create table if not exists exit_docs (
    id        bigserial primary key,
    source    text not null,        -- file the chunk came from, e.g. 'exit_policy.md'
    section   text,                 -- human label, e.g. '§4.2 Final settlement'
    content   text not null,        -- the chunk text itself
    embedding vector(1536)          -- the chunk, as a vector
);

-- hnsw needs no training data and works from the first row, unlike ivfflat.
create index if not exists idx_exit_docs_embedding
    on exit_docs using hnsw (embedding vector_cosine_ops);
