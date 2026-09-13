-- ============================================================
-- 0012_profiles_out_of_office.sql — Agent #11 (Smart Routing): real
-- availability signal on profiles. Default false; HR/manager/IT flip it
-- manually (no calendar integration in this demo -- see smart_routing.py).
-- ============================================================

alter table public.profiles
    add column if not exists out_of_office boolean not null default false;
