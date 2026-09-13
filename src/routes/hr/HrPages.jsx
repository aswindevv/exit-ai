import { useOutletContext } from 'react-router-dom'
import PageHead from '../../components/PageHead'
import Placeholder from '../shared/Placeholder'
import { fmtDate } from '../../lib/format'

const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', completed: 'Completed' }
const STATUS_TONE = { open: 't-neutral', in_progress: 't-accent', completed: 't-success' }
const RISK_TONE = { low: 't-success', medium: 't-warning', high: 't-danger' }
const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }
const SEVERITY_TONE = { low: 't-neutral', medium: 't-warning', high: 't-danger' }
const SENTIMENT_TONE = { positive: 't-success', neutral: 't-neutral', negative: 't-danger' }

export function Dashboard() {
  const { profile, cases, alerts, runs } = useOutletContext()
  const firstName = profile?.full_name?.split(' ')[0] ?? ''
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))

  const active = cases.filter((c) => c.status !== 'completed').length
  const pendingClearances = cases.filter((c) => c.status === 'open').length
  const highRisk = cases.filter((c) => c.risk_level === 'high').length
  const completed = cases.filter((c) => c.status === 'completed').length
  const depts = new Set(cases.map((c) => c.department)).size

  const CHIPS = [
    { tone: 't-plain', k: 'Period', v: new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) },
    highRisk > 0 && { tone: 't-danger', text: `${highRisk} high risk` },
  ].filter(Boolean)

  const KPIS = [
    { label: 'Active exits', value: String(active), color: null },
    { label: 'Pending clearances', value: String(pendingClearances), color: 'var(--text-warning)' },
    { label: 'High risk', value: String(highRisk), color: 'var(--text-danger)' },
    { label: 'Completed', value: String(completed), color: 'var(--text-success)' },
  ]

  const deptCounts = {}
  for (const c of cases) deptCounts[c.department] = (deptCounts[c.department] ?? 0) + 1
  const maxDept = Math.max(1, ...Object.values(deptCounts))
  const DEPTS = Object.entries(deptCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([dept, count]) => ({ dept, count: String(count), width: `${Math.round((count / maxDept) * 100)}%` }))

  return (
    <>
      <h2 className="sr-only">
        HR exit dashboard with a sidebar nav, KPI cards, all exit cases table
        including agent risk, trend alerts, attrition by department, and an
        analytics narrative.
      </h2>

      <PageHead
        greeting={`Good morning, ${firstName}`}
        subtitle={`${active} exits in progress across ${depts} departments.`}
        chips={CHIPS}
      />

      <div className="kpi-row mb">
        {KPIS.map((k) => (
          <span className="kpi" key={k.label}>
            {k.label}{' '}
            <b style={k.color ? { color: k.color } : undefined}>{k.value}</b>
          </span>
        ))}
      </div>

      <div className="two-col mb">
        <div className="card card--pad">
          <p className="card-title">All exit cases</p>
          <div className="list">
            <div className="thead">
              <span style={{ flex: 1.4 }}>Employee</span>
              <span style={{ flex: 1 }}>Department</span>
              <span style={{ width: 56 }}>Last day</span>
              <span style={{ width: 74 }}>Status</span>
              <span style={{ width: 72, textAlign: 'right' }}>Risk (agent)</span>
            </div>
            {cases.map((c) => (
              <div className="row" key={c.id}>
                <span style={{ flex: 1.4 }}>{c.employee_name}</span>
                <span className="c-secondary" style={{ flex: 1 }}>{c.department}</span>
                <span className="c-secondary" style={{ width: 56 }}>{fmtDate(c.last_working_day)}</span>
                <span style={{ width: 74 }}>
                  <span className={`tag ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                </span>
                <span style={{ width: 72, textAlign: 'right' }}>
                  {c.risk_level ? (
                    <span className={`tag ${RISK_TONE[c.risk_level]}`}>
                      {c.risk_level[0].toUpperCase() + c.risk_level.slice(1)} {Math.round(c.risk_score)}
                    </span>
                  ) : (
                    <span className="tag t-neutral">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card card--warned card--pad">
            <p className="card-title">Trend alerts</p>
            <div className="list">
              {alerts.length ? (
                alerts.map((a) => (
                  <div className="row row--split" key={a.id}>
                    <div>
                      <p>{a.theme}</p>
                      <p className="sub">{[a.department, a.detail].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className={`tag ${SEVERITY_TONE[a.severity]}`}>{SEVERITY_LABEL[a.severity]}</span>
                  </div>
                ))
              ) : (
                <div className="row">
                  <p className="c-muted">No trend alerts yet — populated by the analytics agent (Phase 6a).</p>
                </div>
              )}
            </div>
          </div>

          <div className="card card--pad">
            <p className="card-title">Exits by department</p>
            <div className="bars">
              {DEPTS.map((d) => (
                <div key={d.dept}>
                  <div className="bar-head">
                    <span>{d.dept}</span>
                    <span className="c-muted">{d.count}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: d.width }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card card--pad">
            <p className="card-title">Agent activity</p>
            <div className="list list--col">
              {runs.length ? (
                runs.map((r) => (
                  <div className="row row--split" key={r.id}>
                    <div>
                      <p>{casesById[r.case_id]?.employee_name ?? 'Unknown case'}</p>
                      <p className="sub">{r.detail}</p>
                    </div>
                    <span className="c-muted">
                      {new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              ) : (
                <div className="row">
                  <p className="c-muted">No agent runs yet — populated by `python -m agents.run_case`.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="strip strip--top">
        <span className="strip-icon">
          <i className="ti ti-chart-line" aria-hidden="true" />
        </span>
        <div className="grow">
          <p className="strip-title">Analytics insight</p>
          <p className="strip-body">
            {active} exits currently in progress across {depts} departments, {highRisk} flagged high risk.
            Bottleneck and attrition narratives arrive once the analytics agent runs (Phase 6a).
          </p>
        </div>
      </div>
    </>
  )
}

export function AllExits() {
  const { cases } = useOutletContext()
  return (
    <div className="card card--pad">
      <p className="card-title">All exit cases</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.4 }}>Employee</span>
          <span style={{ flex: 1 }}>Department</span>
          <span style={{ width: 56 }}>Last day</span>
          <span style={{ width: 74 }}>Status</span>
          <span style={{ width: 72, textAlign: 'right' }}>Risk (agent)</span>
        </div>
        {cases.map((c) => (
          <div className="row" key={c.id}>
            <span style={{ flex: 1.4 }}>{c.employee_name}</span>
            <span className="c-secondary" style={{ flex: 1 }}>{c.department}</span>
            <span className="c-secondary" style={{ width: 56 }}>{fmtDate(c.last_working_day)}</span>
            <span style={{ width: 74 }}>
              <span className={`tag ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
            </span>
            <span style={{ width: 72, textAlign: 'right' }}>
              {c.risk_level ? (
                <span className={`tag ${RISK_TONE[c.risk_level]}`}>
                  {c.risk_level[0].toUpperCase() + c.risk_level.slice(1)} {Math.round(c.risk_score)}
                </span>
              ) : (
                <span className="tag t-neutral">—</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RiskAndCompliance() {
  const { cases } = useOutletContext()
  const sorted = [...cases].sort((a, b) => (b.risk_score ?? -1) - (a.risk_score ?? -1))
  return (
    <div className="card card--pad">
      <p className="card-title">Risk and compliance</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.4 }}>Employee</span>
          <span style={{ flex: 1 }}>Department</span>
          <span style={{ width: 70 }}>Risk level</span>
          <span style={{ width: 50 }}>Score</span>
          <span style={{ width: 80, textAlign: 'right' }}>Rehire eligible</span>
        </div>
        {sorted.map((c) => (
          <div className="row" key={c.id}>
            <span style={{ flex: 1.4 }}>{c.employee_name}</span>
            <span className="c-secondary" style={{ flex: 1 }}>{c.department}</span>
            <span style={{ width: 70 }}>
              {c.risk_level ? (
                <span className={`tag ${RISK_TONE[c.risk_level]}`}>{c.risk_level[0].toUpperCase() + c.risk_level.slice(1)}</span>
              ) : (
                <span className="tag t-neutral">—</span>
              )}
            </span>
            <span className="c-secondary" style={{ width: 50 }}>{c.risk_score != null ? Math.round(c.risk_score) : '—'}</span>
            <span style={{ width: 80, textAlign: 'right' }}>
              {c.rehire_eligible == null ? (
                <span className="tag t-neutral">—</span>
              ) : (
                <span className={`tag ${c.rehire_eligible ? 't-success' : 't-danger'}`}>{c.rehire_eligible ? 'Yes' : 'No'}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExitInterviews() {
  const { cases, interviews } = useOutletContext()
  if (!interviews.length) {
    return <Placeholder title="Exit interviews" body="No exit interviews submitted yet." />
  }
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))
  return (
    <div className="card card--pad">
      <p className="card-title">Exit interviews</p>
      <div className="list list--col">
        {interviews.map((iv) => (
          <div key={iv.id} className="row row--split">
            <div>
              <p>{casesById[iv.case_id]?.employee_name ?? 'Unknown employee'}</p>
              <p className="sub">{iv.summary}</p>
              {iv.themes?.length > 0 && <p className="sub c-secondary">{iv.themes.join(', ')}</p>}
            </div>
            {iv.sentiment && (
              <span className={`tag ${SENTIMENT_TONE[iv.sentiment] ?? 't-neutral'}`}>
                {iv.sentiment[0].toUpperCase() + iv.sentiment.slice(1)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Trends() {
  const { alerts } = useOutletContext()
  if (!alerts.length) {
    return <Placeholder title="Trends" body="No trend alerts yet — populated by the analytics agent (Phase 6a)." />
  }
  return (
    <div className="card card--warned card--pad">
      <p className="card-title">Trend alerts</p>
      <div className="list">
        {alerts.map((a) => (
          <div className="row row--split" key={a.id}>
            <div>
              <p>{a.theme}</p>
              <p className="sub">{[a.department, a.detail].filter(Boolean).join(' · ')}</p>
            </div>
            <span className={`tag ${SEVERITY_TONE[a.severity]}`}>{SEVERITY_LABEL[a.severity]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Clearances() {
  const { cases, tasks } = useOutletContext()
  const casesById = Object.fromEntries(cases.map((c) => [c.id, c]))
  const financeTasks = tasks.filter((t) => t.stage === 'finance')
  return (
    <div className="card card--pad">
      <p className="card-title">Clearances</p>
      <div className="list">
        <div className="thead">
          <span style={{ flex: 1.4 }}>Employee</span>
          <span style={{ flex: 1.4 }}>Task</span>
          <span style={{ width: 70, textAlign: 'right' }}>Status</span>
        </div>
        {financeTasks.map((t) => (
          <div className="row" key={t.id}>
            <span style={{ flex: 1.4 }}>{casesById[t.case_id]?.employee_name ?? '—'}</span>
            <span className="c-secondary" style={{ flex: 1.4 }}>{t.title}</span>
            <span style={{ width: 70, textAlign: 'right' }}>
              <span className={`tag ${t.status === 'done' ? 't-success' : 't-warning'}`}>
                {t.status === 'done' ? 'Signed' : 'Pending'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Reports() {
  const { insight } = useOutletContext()
  if (!insight) {
    return <Placeholder title="Reports" body="No analytics report generated yet — populated by the analytics agent (Phase 6a)." />
  }
  const stats = insight.stats && typeof insight.stats === 'object' ? Object.entries(insight.stats) : []
  return (
    <div className="card card--pad">
      <p className="card-title">Reports</p>
      <p className="c-muted" style={{ marginBottom: 10 }}>{insight.narrative}</p>
      {stats.length > 0 && (
        <div className="list list--col">
          {stats.map(([k, v]) => (
            <div key={k} className="row row--split">
              <span>{k}</span>
              <span className="c-secondary">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Settings() {
  return <Placeholder title="Settings" body="Workspace settings aren't built yet." />
}
