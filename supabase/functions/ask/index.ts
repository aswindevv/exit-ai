// ─── What this file does ─────────────────────────────────────────────────────
// This is the RAG (Retrieval-Augmented Generation) assistant Edge Function.
// When an employee types a question in the chat, the frontend calls this function.
// It turns the question into a vector (numbers that capture meaning), finds the
// closest matching chunks of the exit policy document, then asks the AI to answer
// using only those chunks as its source -- so answers are grounded in real policy.
// ─────────────────────────────────────────────────────────────────────────────
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

// The model reports which sections it used as DATA (not prose) so the UI can
// render exactly one citation line from the sections that actually grounded
// the answer -- rather than the model writing its own "Sections used:" trailer
// while the UI separately lists every retrieved chunk.
// "scope" is what lets the UI label a general-knowledge answer as NOT company
// policy. Company-specific facts (notice lengths, settlement timelines,
// amounts, entitlements) must only ever come from the retrieved context --
// an employee acts on those, so an invented one is the failure that matters.
const SYSTEM_PROMPT = `You are the ExitAI assistant, helping an employee through the company exit process.

Reply with ONLY a JSON object, no markdown fences, with exactly these three keys:

"scope": one of "policy", "general", "refused".
  "policy"  - the provided context answers the question.
  "general" - the context does NOT answer it, but the question is about work, employment, HR, or leaving a job, so general guidance is useful.
  "refused" - the question has nothing to do with work, employment, HR, or exiting a job.

"answer": 2-3 plain sentences addressed to the employee. Never put citations, section titles, section numbers, or a "Sections used" line in this field.
  If scope is "policy": answer strictly from the context.
  If scope is "general": give genuinely useful general guidance, and NEVER state a company-specific fact as if it were this company's rule - no notice periods, settlement timelines, deadlines, amounts, or entitlements. Say those depend on their contract and HR.
  If scope is "refused": one short sentence saying this isn't something you can help with, and to contact HR.

"sections": an array of the section titles you used, copied exactly as they appear in square brackets in the context. Must be [] unless scope is "policy".`

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
  // Normalize typographic apostrophes first: the gateway model emits U+2019
  // ("don’t") where the previous one emitted ASCII ("don't"), and an unmatched
  // refusal costs the employee the Forward-to-HR button.
  const normalized = answer.replace(/[‘’ʼ]/g, "'")
  return /\bdon't have\b|\bdo not have\b/i.test(normalized)
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

// embed() converts a text string into a vector of 1536 numbers.
// Semantically similar texts produce similar vectors, so we can find
// policy chunks that are "close in meaning" to the user's question.
// This is called "text embedding" -- the foundation of RAG search.
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

// Strips a "Sections used: ..." / "Source: ..." trailer if the model writes one
// into the prose anyway. The citation is rendered from `sections`, so a trailer
// here would show up twice.
function stripCitationLine(answer: string): string {
  return answer.replace(/\s*(?:^|\n)\s*(?:sections?\s+used|sources?)\s*:.*$/is, '').trim()
}

// Decode one JSON string body, tolerating the literal newlines models sometimes
// emit inside a quoted string (which strict JSON.parse rejects).
function jsonUnescape(text: string): string {
  try {
    return JSON.parse(`"${text.replace(/\r/g, '').replace(/\n/g, '\\n')}"`)
  } catch {
    return text
  }
}

type Scope = 'policy' | 'general' | 'refused'

const asScope = (value: unknown): Scope | null =>
  value === 'policy' || value === 'general' || value === 'refused' ? value : null

function parseReply(raw: string): { answer: string; sections: string[]; scope: Scope | null } {
  const block = raw.match(/\{[\s\S]*\}/)?.[0]
  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : []

  if (block) {
    try {
      const parsed = JSON.parse(block)
      if (typeof parsed?.answer === 'string') {
        return {
          answer: stripCitationLine(parsed.answer),
          sections: asStrings(parsed.sections),
          scope: asScope(parsed.scope),
        }
      }
    } catch {
      // Almost-JSON (usually an unescaped newline). Pull the fields out by hand
      // -- showing the employee raw JSON scaffolding would be worse.
      const answer = block.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
      if (answer !== undefined) {
        const list = block.match(/"sections"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
        return {
          answer: stripCitationLine(jsonUnescape(answer)),
          sections: [...list.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => jsonUnescape(m[1])),
          scope: asScope(block.match(/"scope"\s*:\s*"(\w+)"/)?.[1]),
        }
      }
    }
  }
  return { answer: stripCitationLine(raw), sections: [], scope: null }
}

async function askModel(context: string, question: string): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANTHROPIC_API_KEY}`,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      // Headroom for the JSON envelope, and for a reasoning model that spends
      // output budget before emitting text (empty content on max_tokens).
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
      ],
    }),
  })
  if (!res.ok) throw new Error(`messages ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const textBlock = json.content.find((block: { type: string }) => block.type === 'text')
  if (!textBlock) throw new Error(`messages: no text block in content: ${JSON.stringify(json.content)}`)
  return textBlock.text
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

    // Step 1: Turn the user's question into a vector (list of numbers).
    const queryEmbedding = await embed(question)

    // Step 2: Find the 4 policy chunks whose vectors are closest to the question.
    // match_exit_docs is a PostgreSQL function (0003_rag.sql) that does this
    // vector similarity search using the pgvector extension.
    const { data: chunks, error } = await db.rpc('match_exit_docs', {
      query_embedding: queryEmbedding,
      match_count: 4,
    })
    if (error) throw new Error(`match_exit_docs: ${error.message}`)

    if (!chunks || chunks.length === 0) {
      // No relevant policy found -- return a safe refusal rather than letting the
      // AI hallucinate an answer with no grounding.
      return new Response(JSON.stringify(REFUSAL), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Step 3: Build a "context" string by joining the retrieved chunks.
    // Each chunk is labelled with its section title so the AI can cite it.
    const context = chunks
      .map((c: { section: string | null; source: string; content: string }) => `[${c.section || c.source}]\n${c.content}`)
      .join('\n\n')

    // Step 4: Ask the AI to answer the question using only the retrieved context.
    const { answer, sections, scope } = parseReply(await askModel(context, question))
    // No scope means the model ignored the JSON contract -- fall back to the
    // wording heuristic so a refusal still reaches the Forward-to-HR path.
    const effectiveScope: Scope = scope ?? (looksLikeRefusal(answer) ? 'refused' : 'policy')
    const refused = effectiveScope === 'refused'
    // General-knowledge answer: not grounded in the policy, so it carries no
    // citations and the UI labels it as guidance rather than company rule.
    const general = effectiveScope === 'general'

    // Cite only what the answer actually used. If the model named nothing
    // usable, fall back to the single best-matching chunk rather than listing
    // every chunk retrieval happened to return.
    let sources: { source: string; section: string | null }[] = []
    if (effectiveScope === 'policy' && chunks[0].similarity >= SIMILARITY_THRESHOLD) {
      const used = new Set(sections.map((s) => s.trim().toLowerCase()).filter(Boolean))
      const matched = chunks.filter((c: { source: string; section: string | null }) =>
        used.has(String(c.section ?? c.source).trim().toLowerCase()),
      )
      const seen = new Set<string>()
      sources = (matched.length > 0 ? matched : [chunks[0]])
        .filter((c: { source: string; section: string | null }) => {
          const key = `${c.source}|${c.section ?? ''}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((c: { source: string; section: string | null }) => ({ source: c.source, section: c.section }))
    }

    return new Response(JSON.stringify({ answer, sources, refused, general }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
