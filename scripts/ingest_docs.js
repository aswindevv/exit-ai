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

// Ported from rag.py's chunk_text(): pack paragraphs up to max_chars, splitting
// on blank lines (each "§n.n Title\nBody" block is one paragraph in the doc).
function chunkText(text, maxChars = 800) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let current = ''
  for (const p of paragraphs) {
    if (current && (current.length + 2 + p.length) > maxChars) {
      chunks.push(current)
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function sectionOf(chunk) {
  const match = chunk.match(/^§[\d.]+\s+(.+)$/m)
  return match ? match[1].trim() : null
}

async function embed(input) {
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
  return json.data[0].embedding
}

async function main() {
  const text = readFileSync(new URL('./exit_policy.md', import.meta.url), 'utf8')
  const chunks = chunkText(text)
  console.log(`chunked ${SOURCE} into ${chunks.length} chunks`)

  const { error: delErr } = await db.from('exit_docs').delete().eq('source', SOURCE)
  if (delErr) throw new Error(`exit_docs.delete: ${delErr.message}`)

  for (const chunk of chunks) {
    const embedding = await embed(chunk)
    if (embedding.length !== 1536) {
      throw new Error(`embedding dim mismatch: got ${embedding.length}, expected 1536`)
    }
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
