import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { supabase } from '../../lib/supabase'
import { initials } from '../../lib/format'

export const NAV = [
  { label: 'Dashboard', to: '', end: true, icon: 'ti-layout-dashboard' },
  { label: 'Help and support', to: 'help', icon: 'ti-help' },
]

export default function FinanceLayout({ session }) {
  const [data, setData] = useState(null)
  const mountedRef = useRef(true)

  async function load() {
    const [{ data: profile }, { data: cases }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', session.user.id).single(),
      supabase.from('finance_case_view').select('*').order('last_working_day'),
    ])
    const caseIds = (cases ?? []).map((c) => c.id)
    const { data: tasks } = caseIds.length
      ? await supabase.from('exit_tasks').select('*').in('case_id', caseIds)
      : { data: [] }
    if (mountedRef.current) setData({ profile, cases: cases ?? [], tasks: tasks ?? [], reload: load })
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [session])

  if (!data) return null

  return (
    <div className="shell">
      <Sidebar items={NAV} initials={initials(data.profile?.full_name)} name={data.profile?.full_name} role="Finance" />
      <div>
        <Outlet context={data} />
      </div>
    </div>
  )
}
