# ─── What this file does ─────────────────────────────────────────────────────
# Loads all secret values (API keys, URLs, passwords) from the .env file and
# makes them available to every agent as named variables. Also creates the shared
# Supabase database client (db) that agents use to read and write case data.
# ─────────────────────────────────────────────────────────────────────────────
"""Shared config/clients for the ExitAI Python agent service (Phase 6a/6b).

Reads secrets from the project's root .env -- the SAME Portkey/Anthropic
gateway values the Edge Functions use (supabase/functions/ask/index.ts):
ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_MODEL. No new secrets needed;
this service is additive and never touches the frontend's VITE_ vars.

Uses SUPABASE_SERVICE_KEY (bypasses RLS) -- same as scripts/seed/seed.js and
scripts/ingest_docs.js. This is a backend-only service, never shipped to the
browser, so that is the correct key here (CLAUDE.md's anon-key rule is a
frontend rule).
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

# load_dotenv reads the .env file and sets each line as an environment variable.
# Environment variables are how secrets (API keys, passwords) are passed to the
# program without being hardcoded in source code. override=True: a stale Windows User-level ANTHROPIC_BASE_URL
# (https://portkey.ai/, wrong host) was shadowing this file's correct value
# and load_dotenv() never overrides pre-existing env vars by default.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env", override=True)

# os.environ["KEY"] reads a required variable -- throws a clear error if it's missing.
# os.environ.get("KEY") reads an optional variable and returns None if absent.
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_BASE_URL = os.environ["ANTHROPIC_BASE_URL"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
ANTHROPIC_MODEL = os.environ["ANTHROPIC_MODEL"]

# Phase 7 -- notifications. Same Gmail account + app password already used by
# supabase/functions/forward-to-hr/index.ts (there under EMAIL_SENDER/
# EMAIL_APP_PASSWORD as Edge Function secrets); this is the Python-side name
# already sitting in the root .env.
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
# Optional real-send gate. Unset -> notifications.py only logs emails, never
# calls SMTP. Set (to any value) -> real sends go out via Gmail SMTP, From
# GMAIL_ADDRESS, To each email's actual intended recipient (employee/manager/
# HR's own address from profiles.email) -- not redirected anywhere.
EMAIL_TEST_RECIPIENT = os.environ.get("EMAIL_TEST_RECIPIENT")

# Phase 8 -- KT calendar booking. CLAUDE.md's blueprint calls for a single
# CALENDAR_API_KEY, but Google Calendar's write API needs OAuth (same kind of
# swap Phase 7 made: GMAIL_ADDRESS/APP_PASSWORD instead of the generic
# EMAIL_API_KEY). A SINGLE shared demo account (aswindevv2005@gmail.com) is
# authorized ONCE via agents/oauth_setup.py against the existing "Exit Auth"
# Google OAuth Web client -- every KT event for every ExitAI user then lands
# on that one account's calendar (KT_CALENDAR_ID), no per-user Google login
# or calendar-sharing step. All optional -- unset -> calendar_booking.py only
# logs the booking.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8765/")
GOOGLE_REFRESH_TOKEN = os.environ.get("GOOGLE_REFRESH_TOKEN")
KT_CALENDAR_ID = os.environ.get("KT_CALENDAR_ID", "primary")

# Create the shared Supabase database client using the service-role key.
# The service-role key bypasses Row Level Security (RLS), giving the Python
# agent pipeline full read/write access to all tables -- appropriate for a
# backend service, never for the browser. Agents import `db` from this module
# and call db.table("exit_cases").select("*")... etc.
db: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
