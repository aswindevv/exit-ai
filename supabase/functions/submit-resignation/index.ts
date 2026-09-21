// ─── What this file does ─────────────────────────────────────────────────────
// This is a Supabase Edge Function (runs in Supabase's cloud, not on our machine).
// When an employee submits their resignation form, the frontend calls this function.
// It creates a row in exit_cases for that employee and returns the new case ID.
// The actual pipeline (checklists, emails, etc.) is triggered separately by the
// frontend calling the local agent service at localhost:8787/activate-exit.
// ─────────────────────────────────────────────────────────────────────────────
// Employee submits their resignation: creates their exit_cases row (if they
// don't already have one). Does NOT trigger any agent — that's a separate
// step. Identity (employee_id/name/email/department) is derived server-side
// from the caller's own session JWT, never trusted from the request body.
// manager_id/hr_id/role_title use the same lookup e2e_test.py's _create_case
// uses (single demo manager, single demo HR, department -> title map),
// because profiles has no manager_id/role_title column of its own.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const DEPARTMENT_TITLES: Record<string, string> = {
  Engineering: 'Software Engineer',
  Sales: 'Sales Executive',
  Marketing: 'Marketing Specialist',
  Finance: 'Financial Analyst',
  Support: 'Support Engineer',
  Product: 'Product Analyst',
  Operations: 'Operations Coordinator',
  HR: 'HR Generalist',
}

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

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })

  try {
    const { last_working_day, reason } = await req.json()
    if (!last_working_day || typeof last_working_day !== 'string') {
      return json({ error: 'last_working_day is required' }, 400)
    }

    // Read the Authorization header the browser sent (contains the session JWT token).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'not signed in' }, 401)

    // Create a second Supabase client that uses the caller's own JWT.
    // This lets Supabase verify who is making the request.
    // We use the anon key + the user's JWT (not the service key) so that Supabase
    // can identify the logged-in user via their session token.
    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return json({ error: 'not signed in' }, 401)

    // Use the service-role (admin) client to look up the employee's profile.
    // We need the service key here because profiles has RLS: an employee can only
    // read their own row, but we also need to read manager/HR profiles below.
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, email, employee_id, department, role')
      .eq('id', user.id)
      .single()
    if (!profile || profile.role !== 'employee') return json({ error: 'not an employee' }, 403)

    // maybeSingle() returns null (not an error) if the employee has no case yet.
    // single() would throw an error if 0 rows were found -- wrong behaviour here.
    const { data: existing } = await admin
      .from('exit_cases')
      .select('id')
      .eq('employee_id', profile.employee_id)
      .maybeSingle()
    // If they already resigned, return the existing case instead of creating a duplicate.
    if (existing) return json({ ok: true, case: existing })

    const { data: manager } = await admin.from('profiles').select('id').eq('role', 'manager').limit(1).single()
    const { data: hr } = await admin.from('profiles').select('id').eq('role', 'hr').limit(1).single()

    const { data: created, error } = await admin
      .from('exit_cases')
      .insert({
        employee_id: profile.employee_id,
        employee_name: profile.full_name,
        email: profile.email,
        department: profile.department,
        role_title: DEPARTMENT_TITLES[profile.department] ?? 'Specialist',
        manager_id: manager?.id ?? null,
        hr_id: hr?.id ?? null,
        last_working_day,
        resignation_reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)

    return json({ ok: true, case: created })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
