"""
RAG pipeline for the ExitAI assistant.

Four moving parts, in the order the pipeline uses them:
  embed()            turn text into a vector
  chunk_text()       split a long doc into retrievable pieces
  ingest_document()  chunk -> embed -> store (run once, offline)
  answer_question()  embed question -> retrieve -> Claude answers from context

Two models, each doing what it's best at:
  - EMBEDDINGS: OpenAI text-embedding-3-small (1536 dims). This is why
    supabase/migrations/0001_schema.sql uses vector(1536). If you ever change
    the embedding model,
    change embed() and the vector(N) dimension together, or every insert
    fails with a dimension mismatch.
  - GENERATION: Anthropic Claude, which turns retrieved chunks into the
    grounded, cited answer.

Why Claude only for the ANSWER, not the retrieval?
  - retrieval is math (cosine similarity), done in the database. Fast, free,
    deterministic. Never pay an LLM to do search.
  - the LLM's only job is to turn the retrieved chunks into a grounded,
    cited answer. That separation is the whole RAG design.
"""

from __future__ import annotations

import os

import anthropic
from openai import OpenAI
from supabase import create_client, Client


# ----------------------------------------------------------------------
# Clients / models (loaded once)
# ----------------------------------------------------------------------

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"],
)

openai = OpenAI()                                     # reads OPENAI_API_KEY
claude = anthropic.Anthropic()                        # reads ANTHROPIC_API_KEY

EMBED_MODEL = "text-embedding-3-small"                # 1536-dim


def embed(text: str) -> list[float]:
    """Text -> 1536-float vector via OpenAI. Same model MUST be used for
    ingest and query, or cosine similarity compares vectors from different
    spaces and returns nonsense."""
    resp = openai.embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding


# ----------------------------------------------------------------------
# Ingestion (run once when docs change)
# ----------------------------------------------------------------------

def chunk_text(text: str, max_chars: int = 800) -> list[str]:
    """
    Split on blank lines (paragraphs), then pack paragraphs together up to
    max_chars. Chunk size is a real tradeoff:
      - too small -> a chunk lacks enough context to answer
      - too big   -> retrieval returns noise around the useful sentence
    ~500-1000 chars is a sane default for policy text.
    """
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) <= max_chars:
            current = f"{current}\n\n{para}" if current else para
        else:
            if current:
                chunks.append(current)
            current = para
    if current:
        chunks.append(current)
    return chunks


def ingest_document(source: str, text: str, section: str | None = None) -> int:
    """Chunk a document, embed each chunk, and store the rows. Returns count."""
    rows = [
        {
            "source": source,
            "section": section,
            "content": chunk,
            "embedding": embed(chunk),
        }
        for chunk in chunk_text(text)
    ]
    if rows:
        supabase.table("exit_docs").insert(rows).execute()
    return len(rows)


# ----------------------------------------------------------------------
# Query (run per user question) -- the actual RAG step
# ----------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are the ExitAI assistant. Answer the employee's question about the "
    "company exit process using ONLY the provided context.\n"
    "- If the answer is not in the context, say you don't have that "
    "information and suggest contacting HR. Do NOT guess.\n"
    "- Keep answers to 2-3 sentences.\n"
    "- After the answer, name the section(s) you used."
)


def answer_question(question: str, k: int = 4) -> dict:
    """
    The RAG query:
      1. embed the question with the SAME model used for ingestion
      2. ask pgvector for the k most similar chunks
      3. hand those chunks to Claude as the only allowed source
      4. return the answer plus the sources (for the citation line in the UI)
    """
    question_embedding = embed(question)

    result = supabase.rpc(
        "match_exit_docs",
        {"query_embedding": question_embedding, "match_count": k},
    ).execute()
    chunks = result.data or []

    # No relevant docs -> refuse rather than hallucinate.
    if not chunks:
        return {
            "answer": "I don't have information on that. Please contact HR.",
            "sources": [],
        }

    context = "\n\n".join(
        f"[{c.get('section') or c['source']}]\n{c['content']}" for c in chunks
    )

    message = claude.messages.create(
        model="claude-sonnet-4-5",              # use the current model id
        max_tokens=500,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {question}",
            }
        ],
    )

    return {
        "answer": message.content[0].text,
        "sources": [
            {"source": c["source"], "section": c.get("section")} for c in chunks
        ],
    }


# ----------------------------------------------------------------------
# Local end-to-end test
# ----------------------------------------------------------------------

if __name__ == "__main__":
    sample_policy = (
        "§4.1 Clearance sequence\n"
        "An employee's exit clearance must be completed by HR, Finance, and IT "
        "before the final relieving letter is issued.\n\n"
        "§4.2 Final settlement\n"
        "Final settlement, including any pending salary and reimbursements, is "
        "processed within 45 days of the last working day, once all clearances "
        "are complete.\n\n"
        "§5.1 Company assets\n"
        "All company assets, including laptops and access cards, must be returned "
        "on or before the last working day."
    )
    n = ingest_document("exit_policy.md", sample_policy)
    print(f"ingested {n} chunks")

    out = answer_question("When will I get my final settlement?")
    print("\nANSWER:\n", out["answer"])
    print("\nSOURCES:\n", out["sources"])
