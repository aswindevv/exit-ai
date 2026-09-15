import { chromium } from 'playwright'
import fs from 'fs'

const env = {}
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const clean = line.replace(/\r$/, '')
  const m = clean.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const SUPABASE_URL = env.SUPABASE_URL
const ANON_KEY = env.SUPABASE_ANON_KEY

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.fill('#login-email', 'aswin@gmail.com')
await page.fill('#login-password', 'aswin@')
await page.click('.login-submit')
await page.waitForURL(/\/it/, { timeout: 10000 })

// pull the current session's access token from localStorage to make authenticated
// REST calls as the logged-in IT user (aswin), same as the frontend would.
const token = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (k.includes('auth-token')) {
      try {
        const v = JSON.parse(localStorage.getItem(k))
        return v.access_token
      } catch {}
    }
  }
  return null
})
console.log('got access token:', !!token)

const probes = [
  { table: 'profiles', cols: 'id,full_name,risk_level,risk_score,rehire_eligible' },
  { table: 'exit_interviews', cols: 'id,sentiment,summary' },
  { table: 'exit_cases', cols: 'id,employee_id,risk_level,risk_score' },
]

for (const p of probes) {
  const url = `${SUPABASE_URL}/rest/v1/${p.table}?select=${p.cols}&limit=5`
  const res = await page.evaluate(async ({ url, anonKey, token }) => {
    const r = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
    })
    const text = await r.text()
    return { status: r.status, body: text.slice(0, 800) }
  }, { url, anonKey: ANON_KEY, token })
  console.log(`\n--- ${p.table} (${p.cols}) ---`)
  console.log('status:', res.status)
  console.log('body:', res.body)
}

await browser.close()
