// Phase 5 ingest: chunk scripts/exit_policy.md, embed each chunk via the Portkey
// embeddings gateway, insert into exit_docs. Uses SERVICE_KEY (never ship this
// file's key into the frontend). Re-runnable: clears prior rows for this source
// before inserting fresh ones, so it stays idempotent.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

process.loadEnvFile()

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_KEY
const portkeyUrl = process.env.PORTKEY_BASE_URL
const portkeyKey = process.env.PORTKEY_API_KEY
const embedModel = process.env.PORTKEY_VIRTUAL_KEY
if (!url || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env')
if (!portkeyUrl || !portkeyKey || !embedModel) {
  throw new Error('PORTKEY_BASE_URL / PORTKEY_API_KEY / PORTKEY_VIRTUAL_KEY missing in .env')
}

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const SOURCE = 'exit_policy.md'

// One chunk per "§n.n Title" section. sectionOf() labels a chunk with only its
// FIRST section, so packing two sections together cites the first one as the
// source of the second one's text — the sections are self-contained, so a
// clean 1:1 split is what keeps citations honest. A section that runs to
// several paragraphs stays whole.
function chunkText(text) {
  // Split the markdown on blank lines to get individual paragraphs.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  for (const p of paragraphs) {
    // A paragraph starting with §1.2 Title begins a new policy section — start a new chunk.
    // Any paragraph without that marker is a continuation of the previous section, so append it.
    if (chunks.length === 0 || /^§[\d.]+\s+/.test(p)) chunks.push(p)
    else chunks[chunks.length - 1] += `\n\n${p}`
  }
  return chunks
}

function sectionOf(chunk) {
  // Extract just the section title (the part after "§1.2 ") from the first line of a chunk.
  // Returns null for chunks that don't start a section (shouldn't happen after chunkText).
  const match = chunk.match(/^§[\d.]+\s+(.+)$/m)
  return match ? match[1].trim() : null
}

async function embed(input) {
  // POST to Portkey's embeddings endpoint — same API shape as OpenAI's /v1/embeddings.
  // embedModel is the PORTKEY_VIRTUAL_KEY which maps to text-embedding-3-small (1536-dim).
  const res = await fetch(`${portkeyUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${portkeyKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: embedModel, input }),
  })
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`)
  const json = await res.json()
  // The API returns an array of embedding objects; [0].embedding is the float vector.
  return json.data[0].embedding
}

async function main() {
  const text = readFileSync(new URL('./exit_policy.md', import.meta.url), 'utf8')
  const chunks = chunkText(text)
  console.log(`chunked ${SOURCE} into ${chunks.length} chunks`)

  // Delete all previous rows for this source first, so re-running stays idempotent
  // (no duplicate chunks if the policy doc is updated and re-ingested).
  const { error: delErr } = await db.from('exit_docs').delete().eq('source', SOURCE)
  if (delErr) throw new Error(`exit_docs.delete: ${delErr.message}`)

  for (const chunk of chunks) {
    const embedding = await embed(chunk)
    // Fail loudly if the embedding dimension doesn't match the pgvector column (1536).
    // A silent dimension mismatch would silently write unusable vectors.
    if (embedding.length !== 1536) {
      throw new Error(`embedding dim mismatch: got ${embedding.length}, expected 1536`)
    }
    // Insert the chunk text + its vector embedding together — the /ask Edge Function
    // queries this table using match_exit_docs() (pgvector cosine similarity) to find
    // the most relevant policy sections for a given employee question.
    const { error } = await db
      .from('exit_docs')
      .insert({ source: SOURCE, section: sectionOf(chunk), content: chunk, embedding })
    if (error) throw new Error(`exit_docs.insert: ${error.message}`)
  }
  console.log(`ingested ${chunks.length} chunks into exit_docs`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
