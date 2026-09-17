// Plain-English rendering of an agent_runs row for HR.
//
// The agents write their own trace strings ("kt_reminder -> smtp_accepted",
// "stage=it approver=Aswin is_delegate=False"), which are the right thing in
// a terminal and the wrong thing on an HR screen. Everything here is DISPLAY
// only: each sentence is built from the row's own stage/detail/status/
// metadata, nothing is inferred beyond what the agent already wrote, and the
// Agent activity page keeps the untouched string one toggle away.
//
// Anything that doesn't match a known shape falls back to the tidied raw
// detail, so a new agent or a reworded trace degrades to today's behaviour
// rather than showing nothing.

// stage -> what HR calls that step, and its icon.
// `phrase` is the same step named mid-sentence ("Routed to Aswin for IT
// clearance"), where the column heading form would read wrong.
export const RUN_STEP = {
  hr: { label: 'HR checklist', icon: 'ti-clipboard-list', phrase: 'the HR checklist' },
  manager: { label: 'Manager gate', icon: 'ti-user-check', phrase: 'manager approval' },
  it: { label: 'IT clearance', icon: 'ti-device-laptop', phrase: 'IT clearance' },
  finance: { label: 'Finance clearance', icon: 'ti-cash', phrase: 'finance clearance' },
  compliance: { label: 'Compliance', icon: 'ti-shield-check', phrase: 'the compliance check' },
  assess: { label: 'Risk assessment', icon: 'ti-gauge', phrase: 'the risk assessment' },
  doc_collection: { label: 'Document check', icon: 'ti-file-search', phrase: 'the document check' },
  it_deprovisioning_execution: { label: 'IT deprovisioning', icon: 'ti-plug-off', phrase: 'IT deprovisioning' },
  multi_system_clearance: { label: 'System clearance', icon: 'ti-checklist', phrase: 'the system clearance check' },
  smart_routing: { label: 'Routing', icon: 'ti-route', phrase: 'routing' },
  sla_escalation: { label: 'SLA escalation', icon: 'ti-clock-exclamation', phrase: 'the SLA escalation' },
  escalate: { label: 'Escalation', icon: 'ti-alert-triangle', phrase: 'the escalation' },
  email_drafting: { label: 'Email', icon: 'ti-mail', phrase: 'the email step' },
  rehire_assessment: { label: 'Rehire check', icon: 'ti-user-plus', phrase: 'the rehire check' },
  e2e_automation: { label: 'Full pipeline', icon: 'ti-robot', phrase: 'the full pipeline' },
}

// What the agents call each email template, and what HR calls it.
const EMAIL_TEMPLATE = {
  resignation_notice: 'resignation notice',
  kt_reminder: 'KT reminder',
  doc_reminder: 'document reminder',
  relieving_letter_notice: 'relieving letter',
}

const SYSTEM = { it: 'IT', hrms: 'HRMS', finance: 'Finance' }

export const runStepLabel = (stage) =>
  RUN_STEP[stage]?.label ?? (stage ? stage.replace(/_/g, ' ') : 'Agent')
export const runStepIcon = (stage) => RUN_STEP[stage]?.icon ?? 'ti-activity'
const stepPhrase = (stage) => RUN_STEP[stage]?.phrase ?? runStepLabel(stage).toLowerCase()

// ---------------------------------------------------------------- parsing
const fields = (detail) => {
  const out = {}
  for (const m of (detail ?? '').matchAll(/([A-Za-z_]\w*)=([^\s,)]+)/g)) out[m[1]] = m[2]
  return out
}
const listField = (detail, key) => {
  const m = new RegExp(`${key}=\\[([^\\]]*)\\]`).exec(detail ?? '')
  return m ? m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean) : []
}
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const andList = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`

// The tidied raw string: code punctuation swapped for the English
// equivalent, nothing dropped. Used as the fallback sentence and as the
// "raw agent output" line.
export function prettyDetail(detail, stage) {
  let text = (detail ?? '').trim()
  if (!text) return '—'
  if (stage) text = text.replace(new RegExp(`^${stage}\\s*:\\s*`, 'i'), '')
  return text
    .replace(/([^\s,])\s+(?=[A-Za-z]\w*=)/g, '$1 · ')
    .replace(/\[\s*\]/g, 'none')
    .replace(/\[([^\]]*)\]/g, (_, items) => `[${items.replace(/'/g, '')}]`)
    .replace(/\s+--\s+/g, ' — ')
    .replace(/_/g, ' ')
    .replace(/\s*->\s*/g, ' → ')
    .replace(/([A-Za-z]\w*)=/g, '$1: ')
    .trim()
}

// ---------------------------------------------------------------- outcome
const STATUS_OUTCOME = {
  verified: { label: 'Verified', tone: 't-success' },
  done: { label: 'Done', tone: 't-success' },
  smtp_accepted: { label: 'Sent', tone: 't-success' },
  failed: { label: 'Failed', tone: 't-danger' },
}

// status is only set by the newer agents, so where it is null the outcome is
// read off the words the agent itself put in the detail -- never guessed.
export function runOutcome(run) {
  if (run.status) {
    return STATUS_OUTCOME[run.status] ?? { label: run.status.replace(/_/g, ' '), tone: 't-neutral' }
  }
  const detail = run.detail ?? ''
  if (run.stage === 'escalate' || run.stage === 'sla_escalation') return { label: 'Escalated', tone: 't-danger' }
  if (/->\s*rejected/i.test(detail)) return { label: 'Rejected', tone: 't-danger' }
  if (/->\s*(verified|validated|accepted)/i.test(detail)) return { label: 'Verified', tone: 't-success' }
  if (/\bblocked\b/i.test(detail)) return { label: 'Blocked', tone: 't-danger' }
  if (/\bPENDING\b/.test(detail)) return { label: 'Pending', tone: 't-warning' }
  if (/\bCLEARED\b/.test(detail)) return { label: 'Cleared', tone: 't-success' }
  if (/^approved$/i.test(detail.trim())) return { label: 'Approved', tone: 't-success' }
  if (/\bdone\b/i.test(detail)) return { label: 'Done', tone: 't-success' }
  return null
}

// --------------------------------------------------------------- sentence
// Short details these agents write verbatim, and what they mean in words.
const PHRASES = {
  'checklist + kt-review done': 'Built the exit checklist and KT review',
  'risk scored': 'Scored the exit risk',
  'clearance checked': 'Checked the finance clearance',
  'deprovisioning plan done': 'Prepared the IT deprovisioning plan',
  approved: 'Approved at the manager gate',
  rejected: 'Rejected at the manager gate',
}

const emailSubject = (template) =>
  EMAIL_TEMPLATE[template] ?? (template ? template.replace(/_/g, ' ') : 'notification')

// Returns { text, note } -- one sentence, plus a supporting line where the
// agent recorded something worth reading (who it emailed, what was missing).
export function runSummary(run) {
  const raw = (run.detail ?? '').trim()
  const stripped = raw.replace(new RegExp(`^${run.stage}\\s*:\\s*`, 'i'), '').trim()
  const fallback = { text: sentence(prettyDetail(run.detail, run.stage)), note: null }

  switch (run.stage) {
    case 'escalate':
    case 'sla_escalation': {
      const reason = /reason:\s*(.+)$/i.exec(raw)?.[1]?.trim()
      return {
        text: run.stage === 'escalate' ? 'Escalated to HR for review' : 'Escalated after an SLA breach',
        note: reason ? `Reason: ${reason}` : stripped || null,
      }
    }

    case 'doc_collection': {
      const doc = /OCR-validated\s+(.+?)\s*->/i.exec(raw)?.[1]?.trim()
      if (!doc) return fallback
      const missing = listField(raw, 'missing')
      return {
        text: `Checked the ${doc}`,
        note: missing.length ? `Could not find ${andList(missing)} in the document` : 'Everything expected was present',
      }
    }

    case 'email_drafting': {
      const template = run.metadata?.template ?? raw.split('->')[0]?.trim()
      const to = run.metadata?.recipients ?? []
      return {
        text: `Sent the ${emailSubject(template)} email`,
        note: to.length ? `To ${to.join(', ')}` : null,
      }
    }

    case 'smart_routing': {
      const f = fields(raw)
      if (!f.stage) return fallback
      return {
        text: f.approver
          ? `Routed to ${f.approver} for ${stepPhrase(f.stage)}`
          : `Routed the case on for ${stepPhrase(f.stage)}`,
        note: f.is_delegate === 'True' ? 'Primary approver was unavailable, so it went to their delegate' : null,
      }
    }

    case 'multi_system_clearance': {
      const f = fields(raw)
      const states = Object.keys(SYSTEM)
        .filter((k) => f[k])
        .map((k) => `${SYSTEM[k]} ${f[k].toLowerCase()}`)
      if (!states.length) return fallback
      return { text: 'Checked clearance in every connected system', note: states.join(' · ') }
    }

    case 'compliance': {
      if (/blocked/i.test(stripped)) {
        // "blocked -- ['NDA: no task found']"
        const inner = /\[([^\]]*)\]/.exec(stripped)?.[1]?.replace(/'/g, '')
        return { text: 'Compliance check is blocked', note: inner ? sentence(inner) : null }
      }
      if (/multi-?system clearance/i.test(stripped)) {
        const f = fields(stripped)
        const states = Object.keys(SYSTEM).filter((k) => f[k]).map((k) => `${SYSTEM[k]} ${f[k].toLowerCase()}`)
        return { text: 'Checked clearance in every connected system', note: states.join(' · ') || null }
      }
      return fallback
    }

    case 'it_deprovisioning_execution':
      return { text: 'Ran the IT deprovisioning steps', note: stripped ? sentence(prettyDetail(stripped)) : null }

    case 'rehire_assessment':
      return { text: 'Assessed rehire eligibility', note: stripped ? sentence(prettyDetail(stripped)) : null }

    case 'e2e_automation':
      return { text: 'Ran the full exit pipeline', note: stripped ? sentence(prettyDetail(stripped)) : null }

    default: {
      const phrase = PHRASES[stripped.toLowerCase()]
      if (phrase) return { text: phrase, note: null }
      if (/^smart routing/i.test(stripped)) {
        return {
          text: `Routed ${stepPhrase(run.stage)} to its approver`,
          note: sentence(prettyDetail(stripped)),
        }
      }
      return fallback
    }
  }
}
