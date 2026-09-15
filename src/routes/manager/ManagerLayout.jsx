import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { supabase } from '../../lib/supabase'
import { initials } from '../../lib/format'

export const NAV = [
  { label: 'Dashboard', to: '', end: true, icon: 'ti-layout-dashboard' },
  { label: 'My team', to: 'my-team', icon: 'ti-users' },
  { label: 'Exiting reports', to: 'exiting-reports', icon: 'ti-file-text' },
  { label: 'KT approvals', to: 'kt-approvals', icon: 'ti-file-search' },
  { label: 'Clearances', to: 'clearances', icon: 'ti-clipboard-check' },
  { label: 'Timeline', to: 'timeline', icon: 'ti-timeline' },
  { label: 'Help and support', to: 'help', icon: 'ti-help' },
]

export default function ManagerLayout({ session }) {
  const [data, setData] = useState(null)
  const mountedRef = useRef(true)

  async function load() {
    const [{ data: profile }, { data: reports }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', session.user.id).single(),
      supabase.from('manager_case_view').select('*').order('last_working_day'),
    ])
    const caseIds = (reports ?? []).map((r) => r.id)
    const { data: tasks } = caseIds.length
      ? await supabase.from('exit_tasks').select('*').in('case_id', caseIds)
      : { data: [] }
    if (mountedRef.current) setData({ profile, reports: reports ?? [], tasks: tasks ?? [], reload: load })
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [session])

  if (!data) return null

  return (
    <div className="shell">
      <Sidebar items={NAV} initials={initials(data.profile?.full_name)} name={data.profile?.full_name} role="Manager" />
      <div>
        <Outlet context={data} />
      </div>
    </div>
  )
}
