import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import useScrollTopOnNavigate from '../../lib/useScrollTopOnNavigate'
import Sidebar from '../../components/Sidebar'
import LoadingShell from '../../components/LoadingShell'
import { supabase } from '../../lib/supabase'
import { initials } from '../../lib/format'
import { readyForRelievingLetter, isOpenEscalation } from './HrPages'
import './hr.css'

const RUNS_PAGE_SIZE = 1000

async function loadAllAgentRuns() {
  const rows = []
  for (let from = 0; ; from += RUNS_PAGE_SIZE) {
    const { data, error } = await supabase.from('agent_runs').select('*')
      .order('created_at', { ascending: false }).range(from, from + RUNS_PAGE_SIZE - 1)
    if (error) return { data: [], error }
    rows.push(...(data ?? []))
    if (!data || data.length < RUNS_PAGE_SIZE) return { data: rows, error: null }
  }
}

const NAV = [
  { key: 'overview', label: 'Overview', to: '', end: true, icon: 'ti-layout-dashboard' },
  { key: 'exits', label: 'Exits', to: 'exits', icon: 'ti-users' },
  { key: 'escalations', label: 'Escalations', to: 'escalations', icon: 'ti-alert-triangle' },
  { key: 'risk', label: 'Risk & rehire', to: 'risk-and-rehire', icon: 'ti-shield-check' },
  { key: 'interviews', label: 'Exit interviews', to: 'exit-interviews', icon: 'ti-message-2' },
  { key: 'letters', label: 'Relieving letters', to: 'relieving-letters', icon: 'ti-file-certificate' },
  { key: 'insights', label: 'Insights', to: 'insights', icon: 'ti-chart-line' },
  { key: 'agents', label: 'Agents', to: 'agents', icon: 'ti-robot' },
]

export default function HrLayout({ session }) {
  const scrollRef = useScrollTopOnNavigate()
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const mountedRef = useRef(true)

  async function load() {
    const [
      { data: profile }, { data: cases }, { data: tasks }, { data: interviews },
      { data: approvedRuns }, runsResult, { data: documents }, { data: staff },
      { data: alerts }, { data: insights }, { data: audits }, { data: optimizations },
      { data: complianceChecks },
    ] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', session.user.id).single(),
      supabase.from('exit_cases').select('*').order('last_working_day'),
      supabase.from('exit_tasks').select('*'),
      supabase.from('exit_interviews').select('*').order('created_at', { ascending: false }),
      supabase.from('agent_runs').select('case_id').eq('stage', 'manager').eq('detail', 'approved'),
      loadAllAgentRuns(),
      supabase.from('case_documents').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role'),
      supabase.from('trend_alerts').select('*').order('created_at', { ascending: false }),
      supabase.from('analytics_insights').select('*').eq('agent_type', 'dashboard_insights').order('created_at', { ascending: false }).limit(1),
      supabase.from('analytics_insights').select('*').eq('agent_type', 'policy_compliance_auditor').order('created_at', { ascending: false }).limit(1),
      supabase.from('analytics_insights').select('*').eq('agent_type', 'workflow_optimizer').order('created_at', { ascending: false }).limit(1),
      supabase.from('compliance_checks').select('*').order('checked_at', { ascending: false }),
    ])
    if (!mountedRef.current) return
    setData({
      profile,
      cases: cases ?? [],
      tasks: tasks ?? [],
      interviews: interviews ?? [],
      approvedCaseIds: new Set((approvedRuns ?? []).map((run) => run.case_id)),
      runs: runsResult.data,
      runsError: runsResult.error,
      documents: documents ?? [],
      staff: staff ?? [],
      alerts: alerts ?? [],
      insight: insights?.[0] ?? null,
      audit: audits?.[0] ?? null,
      optimization: optimizations?.[0] ?? null,
      complianceChecks: complianceChecks ?? [],
      userId: session.user.id,
      reload: load,
    })
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => { mountedRef.current = false }
  }, [session])

  useEffect(() => {
    setQuery('')
    setSearchOpen(false)
  }, [location.pathname])

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle || !data) return []
    return data.cases.filter((exitCase) => exitCase.employee_name?.toLowerCase().includes(needle)).slice(0, 6)
  }, [data, query])

  if (!data) return <LoadingShell role="hr" />

  const openEscalations = data.tasks.filter(isOpenEscalation).length
  const readyLetters = data.cases.filter((exitCase) => readyForRelievingLetter(exitCase, data.tasks)).length
  const counts = { escalations: openEscalations, letters: readyLetters }
  const navItems = NAV.map((item) => ({
    ...item,
    label: (
      <span className="hr-nav-label">
        <span>{item.label}</span>
        {counts[item.key] > 0 && <span className="hr-nav-count" aria-label={`${counts[item.key]} open`}>{counts[item.key]}</span>}
      </span>
    ),
  }))

  function openCase(exitCase) {
    navigate(`/hr/exits/${exitCase.id}`)
  }

  return (
    <div className="shell shell--hr hr-workspace">
      <Sidebar items={navItems} initials={initials(data.profile?.full_name)} name={data.profile?.full_name} role="HR" />
      <div ref={scrollRef} className="hr-workspace__content">
        <header className="hr-topbar">
          <form
            className="hr-global-search"
            role="search"
            onSubmit={(event) => { event.preventDefault(); if (searchResults[0]) openCase(searchResults[0]) }}
          >
            <i className="ti ti-search" aria-hidden="true" />
            <label className="sr-only" htmlFor="hr-case-search">Find an employee case</label>
            <input
              id="hr-case-search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
              placeholder="Find an employee case"
              autoComplete="off"
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><i className="ti ti-x" /></button>}
            {searchOpen && query.trim() && (
              <div className="hr-global-search__results">
                {searchResults.length ? searchResults.map((exitCase) => (
                  <button type="button" key={exitCase.id} onMouseDown={(event) => event.preventDefault()} onClick={() => openCase(exitCase)}>
                    <span>{exitCase.employee_name}</span>
                    <small>{[exitCase.department, exitCase.role_title].filter(Boolean).join(' · ')}</small>
                  </button>
                )) : <p>No matching employee cases.</p>}
              </div>
            )}
          </form>
        </header>
        <Outlet context={data} />
      </div>
    </div>
  )
}
