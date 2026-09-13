import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import { supabase } from '../../lib/supabase'
import { fmtDate, daysUntil } from '../../lib/format'

const BTN = { fontSize: 11, padding: '4px 9px' }

function dayTone(dateStr) {
  const d = daysUntil(dateStr)
  if (d <= 3) return 't-danger'
  if (d <= 10) return 't-accent'
  return 't-neutral'
}

// KT approval (manager "Review") and clearance sign-off (manager "Sign") are
// both just approving a task -- mark it done. RLS (0008) only lets a manager
// do this for their own reports' manager/finance-stage tasks, and only to
// 'done', so this can't be used to un-approve or touch other rows.
function useApprove(reload) {
  const [actioning, setActioning] = useState({})
  async function approveTask(taskId) {
    setActioning((a) => ({ ...a, [taskId]: 'pending' }))
    const { error } = await supabase.from('exit_tasks').update({ status: 'done' }).eq('id', taskId)
    if (error) {
      setActioning((a) => ({ ...a, [taskId]: error.message }))
      return
    }
    await reload()
    setActioning((a) => {
      const next = { ...a }
      delete next[taskId]
      return next
    })
  }
  return [actioning, approveTask]
}

export function Dashboard() {
  const { profile, reports, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const reportsById = Object.fromEntries(reports.map((r) => [r.id, r]))

  const ktTasks = tasks.filter((t) => t.stage === 'manager')
  const financeTasks = tasks.filter((t) => t.stage === 'finance' && t.status !== 'done')
  const ktToReview = ktTasks.filter((t) => t.status !== 'done').length

  const CHIPS = [
    { tone: 't-plain', k: 'Reports', v: String(reports.length) },
    ktToReview + financeTasks.length > 0 && { tone: 't-warning', text: `${ktToReview + financeTasks.length} awaiting you` },
  ].filter(Boolean)

  const KPIS = [
    { label: 'Exiting reports', value: String(reports.length) },
    { label: 'KT to review', value: String(ktToReview), valueClass: 'c-warning' },
    { label: 'Clearances to sign', value: String(financeTasks.length), valueClass: 'c-accent' },
  ]

  return (
    <>
      <h2 className="sr-only">
        Manager dashboard with a sidebar nav, team exit summary, exiting reports
        table, knowledge-transfer approvals, and a KT review summary.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle={`${reports.length} of your reports are exiting this month.`}
        chips={CHIPS}
      />

      <div className="kpi-row mb">
        {KPIS.map((k) => (
          <span key={k.label} className="kpi">
            {k.label} <b className={k.valueClass}>{k.value}</b>
          </span>
        ))}
      </div>

      <div className="card card--pad mb">
        <p className="card-title">My team's exits</p>
        <div className="list">
          <div className="thead">
            <span style={{ flex: 1.4 }}>Employee</span>
            <span style={{ flex: 1.2 }}>Role</span>
            <span style={{ flex: 1 }}>Department</span>
            <span style={{ width: 70, textAlign: 'right' }}>Last day</span>
          </div>
          {reports.map((e) => (
            <div className="row" key={e.id}>
              <span style={{ flex: 1.4 }}>{e.employee_name}</span>
              <span className="c-secondary" style={{ flex: 1.2 }}>{e.role_title}</span>
              <span className="c-secondary" style={{ flex: 1 }}>{e.department}</span>
              <span style={{ width: 70, textAlign: 'right' }}>
                <span className={`tag ${dayTone(e.last_working_day)}`}>{fmtDate(e.last_working_day)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col two-col--even mb">
        <div className="card card--pad">
          <p className="card-title">KT approvals</p>
          <div className="list">
            {ktTasks.map((t) => (
              <div className="row row--split" key={t.id}>
                <div>
                  <p>{reportsById[t.case_id]?.employee_name}</p>
                  <p className="sub">{t.title}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ''}</p>
                </div>
                {t.status === 'done' ? (
                  <span className="tag t-success">Approved</span>
                ) : (
                  <div style={{ textAlign: 'right' }}>
                    <button
                      style={BTN}
                      onClick={() => approveTask(t.id)}
                      disabled={actioning[t.id] === 'pending'}
                    >
                      {actioning[t.id] === 'pending' ? 'Approving…' : 'Review'}
                    </button>
                    {actioning[t.id] && actioning[t.id] !== 'pending' && (
                      <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[t.id]}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card card--pad">
          <p className="card-title">Clearances to sign</p>
          <div className="list">
            {financeTasks.map((t) => (
              <div className="row row--split" key={t.id}>
                <div>
                  <p>{t.title}</p>
                  <p className="sub">{reportsById[t.case_id]?.employee_name}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <button
                    style={BTN}
                    onClick={() => approveTask(t.id)}
                    disabled={actioning[t.id] === 'pending'}
                  >
                    {actioning[t.id] === 'pending' ? 'Signing…' : 'Sign'}
                  </button>
                  {actioning[t.id] && actioning[t.id] !== 'pending' && (
                    <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[t.id]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="strip strip--top">
        <span className="strip-icon">
          <i className="ti ti-file-search" aria-hidden="true" />
        </span>
        <div className="grow">
          <p className="strip-title">KT review summary</p>
          <p className="strip-body">
            {ktToReview} knowledge-transfer item{ktToReview === 1 ? '' : 's'} awaiting your review across{' '}
            {reports.length} exiting report{reports.length === 1 ? '' : 's'}. Gap analysis is generated by the
            HR agent once KT documents are submitted (Phase 6b).
          </p>
        </div>
      </div>
    </>
  )
}

export function MyTeam() {
  const { reports } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">My team's exits</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.4 }}>Employee</span>
          <span style={{ flex: 1.2 }}>Role</span>
          <span style={{ flex: 1 }}>Department</span>
          <span style={{ width: 70, textAlign: 'right' }}>Last day</span>
        </div>
        {reports.map((e) => (
          <div className="row" key={e.id}>
            <span style={{ flex: 1.4 }}>{e.employee_name}</span>
            <span className="c-secondary" style={{ flex: 1.2 }}>{e.role_title}</span>
            <span className="c-secondary" style={{ flex: 1 }}>{e.department}</span>
            <span style={{ width: 70, textAlign: 'right' }}>
              <span className={`tag ${dayTone(e.last_working_day)}`}>{fmtDate(e.last_working_day)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExitingReports() {
  const { reports, tasks } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">Exiting reports</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.4 }}>Employee</span>
          <span style={{ flex: 1 }}>Department</span>
          <span style={{ width: 70 }}>Last day</span>
          <span style={{ width: 90, textAlign: 'right' }}>Progress</span>
        </div>
        {reports.map((e) => {
          const caseTasks = tasks.filter((t) => t.case_id === e.id)
          const done = caseTasks.filter((t) => t.status === 'done').length
          return (
            <div className="row" key={e.id}>
              <span style={{ flex: 1.4 }}>{e.employee_name}</span>
              <span className="c-secondary" style={{ flex: 1 }}>{e.department}</span>
              <span className="c-secondary" style={{ width: 70 }}>{fmtDate(e.last_working_day)}</span>
              <span style={{ width: 90, textAlign: 'right' }} className="c-secondary">
                {caseTasks.length ? `${done} of ${caseTasks.length}` : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function KtApprovals() {
  const { reports, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const reportsById = Object.fromEntries(reports.map((r) => [r.id, r]))
  const ktTasks = tasks.filter((t) => t.stage === 'manager')
  return (
    <div className="card card--pad">
      <p className="card-title">KT approvals</p>
      <div className="list">
        {ktTasks.map((t) => (
          <div className="row row--split" key={t.id}>
            <div>
              <p>{reportsById[t.case_id]?.employee_name}</p>
              <p className="sub">{t.title}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ''}</p>
            </div>
            {t.status === 'done' ? (
              <span className="tag t-success">Approved</span>
            ) : (
              <div style={{ textAlign: 'right' }}>
                <button style={BTN} onClick={() => approveTask(t.id)} disabled={actioning[t.id] === 'pending'}>
                  {actioning[t.id] === 'pending' ? 'Approving…' : 'Review'}
                </button>
                {actioning[t.id] && actioning[t.id] !== 'pending' && (
                  <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[t.id]}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Clearances() {
  const { reports, tasks, reload } = useOutletContext()
  const [actioning, approveTask] = useApprove(reload)
  const reportsById = Object.fromEntries(reports.map((r) => [r.id, r]))
  const financeTasks = tasks.filter((t) => t.stage === 'finance')
  return (
    <div className="card card--pad">
      <p className="card-title">Clearances to sign</p>
      <div className="list">
        {financeTasks.map((t) => (
          <div className="row row--split" key={t.id}>
            <div>
              <p>{t.title}</p>
              <p className="sub">{reportsById[t.case_id]?.employee_name}</p>
            </div>
            {t.status === 'done' ? (
              <span className="tag t-success">Signed</span>
            ) : (
              <div style={{ textAlign: 'right' }}>
                <button style={BTN} onClick={() => approveTask(t.id)} disabled={actioning[t.id] === 'pending'}>
                  {actioning[t.id] === 'pending' ? 'Signing…' : 'Sign'}
                </button>
                {actioning[t.id] && actioning[t.id] !== 'pending' && (
                  <p className="sub c-danger" style={{ marginTop: 2 }}>{actioning[t.id]}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Timeline() {
  const { reports } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">Timeline</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.4 }}>Employee</span>
          <span style={{ flex: 1 }}>Role</span>
          <span style={{ width: 70, textAlign: 'right' }}>Last day</span>
        </div>
        {reports.map((e) => (
          <div className="row" key={e.id}>
            <span style={{ flex: 1.4 }}>{e.employee_name}</span>
            <span className="c-secondary" style={{ flex: 1 }}>{e.role_title}</span>
            <span style={{ width: 70, textAlign: 'right' }}>
              <span className={`tag ${dayTone(e.last_working_day)}`}>{fmtDate(e.last_working_day)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
