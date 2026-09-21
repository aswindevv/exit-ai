// ── What this file does ──────────────────────────────────────────────────
// Creates and exports the single shared Supabase client used by all React
// components. It uses the anon (public) key, which is safe to ship in the
// browser because Row Level Security (RLS) in the database ensures each
// user can only read or write the rows they are allowed to see.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

// VITE_ prefix means Vite will embed these values into the browser bundle.
// Never reference SUPABASE_SERVICE_KEY here — that key bypasses RLS entirely.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
