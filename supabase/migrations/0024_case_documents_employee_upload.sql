-- Phase 4 (#16 Document Collection): real employee upload path.
--
-- Checked storage.buckets on the live project first (Global Rule #2) -- it
-- was empty. No 'exit-documents' bucket existed at all, and case_documents
-- (0011) had only an HR select policy. Employees had no way to get a file
-- into storage or into case_documents -- doc_collection.py's real OCR logic
-- was unreachable except via its own --make-test-doc helper. This adds the
-- minimum surface for the real flow the plan requires: Employee Upload ->
-- case_documents row (status='submitted' by column default) ->
-- agents.spokes.doc_collection OCR-validates it.
--
-- Storage path convention: '<case_id>/<doc_type>-<ms-timestamp>.<ext>' --
-- always a fresh object (no overwrite, so no storage UPDATE policy needed);
-- storage.foldername(name)[1] is the case_id, checked with the same
-- owns_exit_case() (0004) helper every other employee-scoped policy in this
-- project already uses.
insert into storage.buckets (id, name, public)
values ('exit-documents', 'exit-documents', false)
on conflict (id) do nothing;

drop policy if exists exit_documents_employee_insert on storage.objects;
create policy exit_documents_employee_insert on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'exit-documents'
        and public.app_current_role() = 'employee'
        and public.owns_exit_case(((storage.foldername(name))[1])::uuid)
    );

-- Employee needs to read their own uploaded object back (upload
-- confirmation); HR needs to open any submitted file for its own case
-- (case_documents_hr_select already lets HR see the row -- without this
-- they couldn't open the file itself).
drop policy if exists exit_documents_employee_select on storage.objects;
create policy exit_documents_employee_select on storage.objects
    for select to authenticated
    using (
        bucket_id = 'exit-documents'
        and public.app_current_role() = 'employee'
        and public.owns_exit_case(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists exit_documents_hr_select on storage.objects;
create policy exit_documents_hr_select on storage.objects
    for select to authenticated
    using (bucket_id = 'exit-documents' and public.app_current_role() = 'hr');

-- case_documents: employees may insert their own case's rows (status stays
-- at its 'submitted' default -- not grantable, same belt-and-suspenders
-- shape as 0016's exit_interviews_employee_insert) and read their own
-- case's rows (so the Documents page can show upload/validation status
-- across reloads).
grant insert (case_id, doc_type, file_path) on public.case_documents to authenticated;

drop policy if exists case_documents_employee_insert on public.case_documents;
create policy case_documents_employee_insert on public.case_documents
    for insert to authenticated
    with check (
        public.app_current_role() = 'employee'
        and public.owns_exit_case(case_id)
    );

drop policy if exists case_documents_employee_select on public.case_documents;
create policy case_documents_employee_select on public.case_documents
    for select to authenticated
    using (
        public.app_current_role() = 'employee'
        and public.owns_exit_case(case_id)
    );
