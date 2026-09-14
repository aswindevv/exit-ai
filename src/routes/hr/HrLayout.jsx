import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { supabase } from '../../lib/supabase'
import { initials } from '../../lib/format'

export const NAV = [
  { label: 'Dashboard', to: '', end: true },
  { label: 'All exits', to: 'all-exits' },
  { label: 'Risk and compliance', to: 'risk-and-compliance' },
  { label: 'Exit interviews', to: 'exit-interviews' },
  { label: 'Trends', to: 'trends' },
  { label: 'Clearances', to: 'clearances' },
  { label: 'Reports', to: 'reports' },
  { label: 'Settings', to: 'settings' },
]

export default function HrLayout({ session }) {
  const [data, setData] = useState(null)
  const mountedRef = useRef(true)

  async function load() {
    const [{ data: profile }, { data: cases }, { data: alerts }, { data: tasks }, { data: interviews }, { data: insights }, { data: runs }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', session.user.id).single(),
      supabase.from('exit_cases').select('*').order('last_working_day'),
      supabase.from('trend_alerts').select('*').order('created_at', { ascending: false }),
      supabase.from('exit_tasks').select('*'),
      supabase.from('exit_interviews').select('*').order('created_at', { ascending: false }),
      supabase.from('analytics_insights').select('*').order('created_at', { ascending: false }).limit(1),
      supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(8),
    ])
    if (mountedRef.current) {
      setData({
        profile,
        cases: cases ?? [],
        alerts: alerts ?? [],
        tasks: tasks ?? [],
        interviews: interviews ?? [],
        insight: insights?.[0] ?? null,
        runs: runs ?? [],
        userId: session.user.id,
        reload: load,
      })
    }
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [session])

  if (!data) return null

  return (
    <div className="shell">
      <Sidebar items={NAV} initials={initials(data.profile?.full_name)} name={data.profile?.full_name} role="HR" />
      <div>
        <Outlet context={data} />
      </div>
    </div>
  )
}
