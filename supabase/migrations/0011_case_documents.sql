-- ============================================================
-- 0011_case_documents.sql — Agent #16 (Document Collection): tracks which
-- required exit documents have been submitted per case, and the real-OCR
-- validation result for each upload.
--
-- Required-doc list itself is deterministic Python (agents/doc_collection.py),
-- same pattern as checklist_generator's role->tasks logic -- not stored here.
-- This table only holds rows that exist once a document has actually been
-- submitted; "missing" is the set difference computed at read time, not a
-- stored status.
-- ============================================================

create table if not exists case_documents (
    id                uuid primary key default gen_random_uuid(),
    case_id           uuid not null references exit_cases (id) on delete cascade,
    doc_type          text not null,
    file_path         text not null,
    status            text not null default 'submitted'
                        check (status = any (array['submitted', 'validated', 'rejected'])),
    validation_detail text,
    created_at        timestamptz not null default now()
);

create index if not exists idx_case_documents_case_id on case_documents (case_id);

alter table public.case_documents enable row level security;

drop policy if exists case_documents_hr_select on public.case_documents;
create policy case_documents_hr_select on public.case_documents
    for select to authenticated
    using (public.app_current_role() = 'hr');
