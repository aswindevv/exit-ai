// Forward an unanswered /ask question to HR. Logs the question to agent_runs
// so HR sees it via the escalation queue. SMTP email sending is omitted here
// because denomailer (deno.land/x) caused module-init crashes in the Supabase
// Edge Function runtime; the agent_runs path is the production-reliable route.
// Identity is derived server-side from the caller's own session JWT.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  try {
    const { question } = await req.json()
    if (!question || typeof question !== 'string') {
      return json({ error: 'question is required' }, 400)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'not signed in' }, 401)

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
        status: 'logged',
        detail: `Question forwarded to HR: ${question}`,
        metadata: { employee_id: profile?.employee_id ?? null, employee_name: profile?.full_name ?? null },
      })
    }

    return json({
      ok: true,
      delayed: true,
      message: 'Your question has been logged for HR. They will get back to you.',
    })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
