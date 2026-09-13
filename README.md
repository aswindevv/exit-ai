# ExitAI

An AI-assisted employee offboarding platform: four role-based dashboards
(Employee, HR, Manager, IT) over one Supabase backend, a RAG assistant, a
LangGraph multi-agent workflow, email notifications, and calendar-based
Knowledge-Transfer (KT) scheduling. Build history and phase-by-phase specs
live in `blueprint.md`.

## Setup

1. **Install frontend deps and env**
   ```
   npm install
   cp .env.example .env   # or create .env with the vars below
   ```

2. **Database** (Supabase MCP already applies these; to run by hand, in order):
   ```
   supabase/migrations/0001_schema.sql
   supabase/migrations/0002_rls.sql
   supabase/migrations/0003_rag.sql
   supabase/migrations/0004_exit_tasks_fix.sql
   supabase/migrations/0006_analytics_insights.sql
   supabase/migrations/0007_kt_reviews.sql
   ```

3. **Seed data** (uses `SUPABASE_SERVICE_KEY`, run locally, never in the browser):
   ```
   npm run seed              # 100 employees + 3 named accounts + a demo case
   node scripts/ingest_docs.js   # embeds scripts/exit_policy.md into exit_docs
   ```

4. **Frontend**
   ```
   npm run dev
   ```

5. **Agent service** (`/agents`, Python -- LangGraph agents #1-9, Phases 6a/6b/7/8):
   ```
   py -m venv agents/.venv
   agents/.venv/Scripts/python.exe -m pip install -r agents/requirements.txt
   ```
   Reads the same root `.env` the Edge Functions use -- no separate secrets.
   Run any agent directly, e.g.:
   ```
   agents/.venv/Scripts/python.exe -m agents.supervisor <case_id>
   ```
   On Windows, set `PYTHONIOENCODING=utf-8` first -- the live trace's
   box-drawing characters don't fit the default console codepage.

6. **End-to-end test** (Phase 9): creates a fresh case for the next
   un-cased seed employee, runs it through the entire pipeline (HR checklist,
   KT review, IT deprovisioning plan, finance clearance, exit-interview
   intelligence, risk scoring, KT calendar booking, notifications), and
   asserts every stage's data landed correctly:
   ```
   PYTHONIOENCODING=utf-8 agents/.venv/Scripts/python.exe -m agents.e2e_test
   ```

## Env vars (`.env`, never commit)

```
SUPABASE_URL=
SUPABASE_ANON_KEY=          # frontend
SUPABASE_SERVICE_KEY=       # scripts / agent service / edge functions ONLY
ANTHROPIC_BASE_URL=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
DEMO_EMAIL_DOMAIN=gmail.com

# Phase 7 -- email (one sender account)
GMAIL_ADDRESS=
GMAIL_APP_PASSWORD=
EMAIL_TEST_RECIPIENT=       # optional; unset = emails are logged, not sent

# Phase 8 -- KT calendar booking (one shared demo Google account, see
# agents/oauth_setup.py)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
KT_CALENDAR_ID=primary      # optional
```

## Demo accounts

| Role     | Name       | Login email                  | Password    |
|----------|------------|-------------------------------|-------------|
| Manager  | Aravidhan  | aravidhan@$DEMO_EMAIL_DOMAIN   | aravidhan@  |
| HR       | Siva       | siva@$DEMO_EMAIL_DOMAIN        | siva@1      |
| IT       | Aswin      | aswin@$DEMO_EMAIL_DOMAIN       | aswin@      |
| Employee | Emp001-100 | <empid>@$DEMO_EMAIL_DOMAIN     | <EmpId>@    |

## Security note (accepted for this demo ONLY)

Seed logins use **deterministic passwords**: an employee's password is
`<EmployeeId>@` (e.g. `Emp001@`). This is an insecure pattern, permitted here
only because all 100 employees are fake seed data. Supabase Auth's default
6-character minimum meant `siva@` (5 chars) had to be padded to `siva@1`.

**Never use deterministic passwords, or any real personal data, outside this
demo.** The `SUPABASE_SERVICE_KEY` bypasses Row-Level Security entirely and
must never appear in frontend code or the browser bundle -- it is used only
in local seed/ingest scripts and the backend agent service.

## Architecture at a glance

- **Frontend**: React + Vite, plain CSS design tokens, anon key + RLS only.
- **Database**: Supabase Postgres + pgvector. RLS enforces that
  `risk_level`, `risk_score`, `rehire_eligible`, and interview
  sentiment/summary are readable by HR alone (`supabase/migrations/0002_rls.sql`).
- **RAG**: `/ask` Edge Function embeds the question, retrieves via
  `match_exit_docs`, and answers only from retrieved context.
- **Agents** (`/agents`, LangGraph, Python): nine agents behind a supervisor
  graph -- see `blueprint.md`'s agent table for what each reads/writes.
  Every node is `@traced_node`-wrapped for a live terminal trace.
