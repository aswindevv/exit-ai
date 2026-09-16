// Per-task clearance state for the Manager and HR "Clearances" pages.
//
// A task row's `status` column is binary and agents write 'done' on rows whose
// TITLE still records why the item was blocked (e.g. "Clear final settlement
// dues -- blocked: prior stages not complete"), so a UI that reads
// `status === 'done'` alone renders "Signed" on an item that is not cleared.
// Derive from what the agent actually wrote instead: the blocked/escalated
// marker in the title, then the case's escalation state, then `status`.
//
// Same four labels/tones as financeStatus.js so a row reads the same way on
// every dashboard.
import { FINANCE_STATUS_TAG } from './financeStatus'

const BLOCKED_RE = /--\s*blocked:\s*(.+)$/i
const ESCALATION_REASON = 'Escalated to HR review'

export function taskClearanceStatus(task, tasks = []) {
  const blocked = task.title?.match(BLOCKED_RE)
  if (blocked) return { key: 'blocked', reason: blocked[1].trim() }
  // An escalation marker row is a record of a problem, never a signed item.
  if (task.title?.startsWith('Escalated')) return { key: 'blocked', reason: ESCALATION_REASON }
  if (task.status === 'done') return { key: 'cleared' }
  if (tasks.some((t) => t.case_id === task.case_id && t.escalation_state === 'open')) {
    return { key: 'blocked', reason: ESCALATION_REASON }
  }
  return { key: 'ready' }
}

export const CLEARANCE_TAG = FINANCE_STATUS_TAG
