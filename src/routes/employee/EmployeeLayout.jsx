import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { supabase } from '../../lib/supabase'
import { initials } from '../../lib/format'

export const NAV = [
  { label: 'Dashboard', to: '', end: true },
  { label: 'My exit', to: 'my-exit' },
  { label: 'My tasks', to: 'tasks' },
  { label: 'Documents', to: 'documents' },
  { label: 'Knowledge transfer', to: 'knowledge-transfer' },
  { label: 'Exit interview', to: 'exit-interview' },
  { label: 'Timeline', to: 'timeline' },
  { label: 'Help and support', to: 'help' },
]

export default function EmployeeLayout({ session }) {
  const [data, setData] = useState(null)
  const mountedRef = useRef(true)

  async function load() {
    const uid = session.user.id
    const [{ data: profile }, { data: exitCase }] = await Promise.all([
      supabase.from('profiles').select('full_name, employee_id').eq('id', uid).single(),
      supabase.from('employee_exit_view').select('*').maybeSingle(),
    ])
    const { data: tasks } = exitCase
      ? await supabase.from('exit_tasks').select('*').eq('case_id', exitCase.id)
      : { data: [] }
    if (mountedRef.current) setData({ profile, exitCase, tasks: tasks ?? [], reload: load })
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [session])

  if (!data) return null
  if (!data.exitCase) return <Navigate to="/employee/resignation" replace />

  return (
    <div className="shell">
      <Sidebar items={NAV} initials={initials(data.profile?.full_name)} name={data.profile?.full_name} role="Employee" />
      <div>
        <Outlet context={data} />
      </div>
    </div>
  )
}
