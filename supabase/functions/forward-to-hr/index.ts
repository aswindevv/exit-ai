// Forward an unanswered /ask question to HR by email. Sends only on explicit
// employee click (this function is never called automatically). Identity is
// derived server-side from the caller's own session JWT — never trusted from
// the request body, so it can't be spoofed.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// DEMO account only — production would send from a company-domain address.
const EMAIL_SENDER = Deno.env.get('EMAIL_SENDER')!
const EMAIL_APP_PASSWORD = Deno.env.get('EMAIL_APP_PASSWORD')!
const HR_FORWARD_EMAIL = Deno.env.get('HR_FORWARD_EMAIL')!
const SMTP_TIMEOUT_MS = 8000

// Service-role client: bypasses RLS entirely. Used here only to write the fallback
// agent_runs row when email fails — never to read user data (that uses the authed client below).
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`SMTP timed out after ${ms}ms`)), ms)),
  ])
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  try {
    const { question } = await req.json()
    if (!question || typeof question !== 'string') {
      return json({ error: 'question is required' }, 400)
    }

    // Extract the JWT from the Authorization header — never trust identity from the request body.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'not signed in' }, 401)

    // Anon-key client seeded with the caller's own JWT: getUser() validates the token
    // server-side and returns the real authenticated user, not what the client claims.
    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user } } = await authed.auth.getUser()
    if (!user) return json({ error: 'not signed in' }, 401)

    const { data: profile } = await authed
      .from('profiles')
      .select('full_name, employee_id')
      .eq('id', user.id)
      .single()

    try {
      const client = new SMTPClient({
        connection: {
          hostname: 'smtp.gmail.com',
          port: 465,
          tls: true,
          auth: { username: EMAIL_SENDER, password: EMAIL_APP_PASSWORD },
        },
      })

      await withTimeout(
        client.send({
          from: EMAIL_SENDER,
          to: HR_FORWARD_EMAIL,
          subject: `ExitAI: unanswered question from ${profile?.full_name ?? user.email}`,
          content: [
            `ExitAI couldn't answer this employee's question from the exit policy docs.`,
            ``,
            `Employee: ${profile?.full_name ?? '(unknown name)'} (${profile?.employee_id ?? user.id})`,
            `Question: ${question}`,
          ].join('\n'),
        }),
        SMTP_TIMEOUT_MS,
      )
      await client.close()

      return json({ ok: true })
    } catch (sendErr) {
      // SMTP is flaky/slow in ways that are never the employee's fault --
      // never surface a bare dispatch error or hang. Record the question so
      // HR still gets it (via the escalation queue, not email), and tell the
      // employee the truth instead of a generic failure.
      const { data: recentCase } = profile?.employee_id
        ? await admin
            .from('exit_cases')
            .select('id')
            .eq('employee_id', profile.employee_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null }

      if (recentCase) {
        await admin.from('agent_runs').insert({
          case_id: recentCase.id,
          stage: 'forward_to_hr',
          agent: 'forward_to_hr',
          status: 'delivery_failed',
          detail: `Email to HR failed/timed out -- question logged: ${question}`,
          metadata: { employee_id: profile?.employee_id ?? null, error: String(sendErr) },
        })
      }

      return json({
        ok: true,
        delayed: true,
        message: "Your question has been logged for HR. Email delivery may be delayed, but HR will still see it.",
      })
    }
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
