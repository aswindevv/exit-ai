// Phase 5 /ask: embed question -> retrieve top-k via match_exit_docs -> Claude
// answers from retrieved context only -> return { answer, sources }.
//
// Security: uses the service-role key (auto-injected by Supabase) to call
// match_exit_docs, which is what actually reaches exit_docs — that table has
// RLS enabled with zero policies, so this function is the only path to it.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PORTKEY_BASE_URL = Deno.env.get('PORTKEY_BASE_URL')!
const PORTKEY_API_KEY = Deno.env.get('PORTKEY_API_KEY')!
const PORTKEY_VIRTUAL_KEY = Deno.env.get('PORTKEY_VIRTUAL_KEY')!
const ANTHROPIC_BASE_URL = Deno.env.get('ANTHROPIC_BASE_URL')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL')!

const SYSTEM_PROMPT = `You are the ExitAI assistant. Answer the employee's question about the company exit process using ONLY the provided context.
- If the answer is not in the context, say you don't have that information and suggest contacting HR. Do NOT guess.
- Keep answers to 2-3 sentences.
- After the answer, name the section(s) you used.`

const REFUSAL = { answer: "I don't have information on that. Please contact HR.", sources: [], refused: true }

// Below this cosine-similarity score, the top chunk isn't actually relevant
// (greetings, chit-chat, out-of-scope questions) — still let Claude reply,
// but don't cite unrelated sections as if they grounded the answer.
const SIMILARITY_THRESHOLD = 0.35

// Claude sometimes refuses in free text (its own "I don't have that in the
// context" wording) instead of hitting the empty-chunks REFUSAL above. This
// heuristic classifies that outcome for the frontend without touching how
// retrieval or generation work.
function looksLikeRefusal(answer: string): boolean {
  return /\bdon't have\b|\bdo not have\b/i.test(answer)
}

// The browser sends a CORS preflight (OPTIONS) before the real POST because
// supabase-js attaches Authorization/apikey + JSON content-type. Every
// response, preflight included, must carry these headers or the browser
// blocks the request before it reaches this function.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function embed(input: string): Promise<number[]> {
  const res = await fetch(`${PORTKEY_BASE_URL}/v1/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PORTKEY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: PORTKEY_VIRTUAL_KEY, input }),
  })
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.data[0].embedding
}

async function askClaude(context: string, question: string): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANTHROPIC_API_KEY}`,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
      ],
    }),
  })
  if (!res.ok) throw new Error(`messages ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.content[0].text
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  try {
    const { question } = await req.json()
    if (!question || typeof question !== 'string') {
      return new Response(JSON.stringify({ error: 'question is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const queryEmbedding = await embed(question)

    const { data: chunks, error } = await db.rpc('match_exit_docs', {
      query_embedding: queryEmbedding,
      match_count: 4,
    })
    if (error) throw new Error(`match_exit_docs: ${error.message}`)

    if (!chunks || chunks.length === 0) {
      return new Response(JSON.stringify(REFUSAL), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const context = chunks
      .map((c: { section: string | null; source: string; content: string }) => `[${c.section || c.source}]\n${c.content}`)
      .join('\n\n')

    const answer = await askClaude(context, question)
    const grounded = chunks[0].similarity >= SIMILARITY_THRESHOLD
    const sources = grounded
      ? chunks.map((c: { source: string; section: string | null }) => ({ source: c.source, section: c.section }))
      : []

    return new Response(JSON.stringify({ answer, sources, refused: looksLikeRefusal(answer) }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
