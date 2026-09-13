import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { supabase } from '../../lib/supabase'
import { initials } from '../../lib/format'

export const NAV = [
  { label: 'Dashboard', to: '', end: true },
  { label: 'Deprovisioning', to: 'deprovisioning' },
  { label: 'Asset recovery', to: 'asset-recovery' },
  { label: 'Access reviews', to: 'access-reviews' },
  { label: 'Approvals', to: 'approvals' },
  { label: 'Audit log', to: 'audit-log' },
  { label: 'Help and support', to: 'help' },
]

export default function ItLayout({ session }) {
  const [data, setData] = useState(null)
  const mountedRef = useRef(true)

  async function load() {
    const [{ data: profile }, { data: tasks }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', session.user.id).single(),
      supabase.from('it_task_view').select('*').order('due_date'),
    ])
    if (mountedRef.current) setData({ profile, tasks: tasks ?? [], reload: load })
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [session])

  if (!data) return null

  return (
    <div className="shell">
      <Sidebar items={NAV} initials={initials(data.profile?.full_name)} name={data.profile?.full_name} role="IT" />
      <div>
        <Outlet context={data} />
      </div>
    </div>
  )
}
