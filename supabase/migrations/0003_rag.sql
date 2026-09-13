-- ============================================================
-- 0003_rag.sql — the RAG search function.
--
-- Moved verbatim from the root schema.sql. The exit_docs table and its hnsw
-- index now live in 0001_schema.sql; its RLS posture is set in 0002_rls.sql.
-- ============================================================

-- The search function the app calls (Supabase exposes this as an RPC).
-- <=> is pgvector's cosine-distance operator. similarity = 1 - distance,
-- so 1.0 is a perfect match. We return the closest `match_count` chunks.
--
-- Deliberately NOT security definer. It runs with the caller's rights, so it
-- inherits exit_docs' RLS: the anon key gets 0 rows here just as it does from
-- a direct select. Only the service-key /ask Edge Function gets real results.
-- Making this security definer would reopen the hole 0002_rls.sql closes.
create or replace function match_exit_docs(
    query_embedding vector(1536),
    match_count int default 4
)
returns table (
    id         bigint,
    source     text,
    section    text,
    content    text,
    similarity double precision
)
language sql stable
as $$
    select
        id,
        source,
        section,
        content,
        1 - (embedding <=> query_embedding) as similarity
    from exit_docs
    order by embedding <=> query_embedding
    limit match_count;
$$;
