// ── What this file does ──────────────────────────────────────────────────
// Maps URL paths to the correct role dashboard. Every route is guarded: if
// the current user's role does not match the route's expected role, they are
// redirected to their own dashboard instead of seeing someone else's pages.
// ─────────────────────────────────────────────────────────────────────────
import { Routes, Route, Navigate } from 'react-router-dom'
import HelpPage from './shared/HelpPage'

import EmployeeLayout from './employee/EmployeeLayout'
import * as Employee from './employee/EmployeePages'

import ManagerLayout from './manager/ManagerLayout'
import * as Manager from './manager/ManagerPages'

import ItLayout from './it/ItLayout'
import * as It from './it/ItPages'

import HrLayout from './hr/HrLayout'
import * as Hr from './hr/HrPages'

import FinanceLayout from './finance/FinanceLayout'
import * as Finance from './finance/FinancePages'

// role is derived from the logged-in user's profiles.role column in Supabase.
// session is the Supabase Auth session object (holds the user's JWT).
export default function AppRoutes({ role, session }) {
  return (
    <Routes>
      {/* /employee/resignation is outside the main employee layout because
          employees who haven't resigned yet land here directly — no sidebar needed. */}
      <Route
        path="/employee/resignation"
        element={role === 'employee' ? <Employee.Resignation session={session} /> : <Navigate to={`/${role}`} replace />}
      />

      <Route
        path="/employee"
        element={role === 'employee' ? <EmployeeLayout session={session} /> : <Navigate to={`/${role}`} replace />}
      >
        <Route index element={<Employee.Dashboard />} />
        <Route path="my-exit" element={<Employee.MyExit />} />
        <Route path="tasks" element={<Employee.Tasks />} />
        <Route path="documents" element={<Employee.Documents />} />
        <Route path="knowledge-transfer" element={<Employee.KnowledgeTransfer />} />
        <Route path="exit-interview" element={<Employee.ExitInterview />} />
        <Route path="timeline" element={<Employee.Timeline />} />
        <Route path="help" element={<HelpPage role="Employee" />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Route>

      <Route
        path="/manager"
        element={role === 'manager' ? <ManagerLayout session={session} /> : <Navigate to={`/${role}`} replace />}
      >
        <Route index element={<Manager.Dashboard />} />
        <Route path="my-team" element={<Manager.MyTeam />} />
        <Route path="exiting-reports" element={<Manager.ExitingReports />} />
        <Route path="kt-approvals" element={<Manager.KtApprovals />} />
        <Route path="clearances" element={<Manager.Clearances />} />
        <Route path="timeline" element={<Manager.Timeline />} />
        <Route path="help" element={<HelpPage role="Manager" />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Route>

      <Route
        path="/it"
        element={role === 'it' ? <ItLayout session={session} /> : <Navigate to={`/${role}`} replace />}
      >
        <Route index element={<It.Dashboard />} />
        <Route path="deprovisioning" element={<It.Deprovisioning />} />
        <Route path="asset-recovery" element={<It.AssetRecovery />} />
        <Route path="access-reviews" element={<It.AccessReviews />} />
        <Route path="approvals" element={<It.Approvals />} />
        <Route path="audit-log" element={<It.AuditLog />} />
        <Route path="help" element={<HelpPage role="IT" />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Route>

      <Route
        path="/hr"
        element={role === 'hr' ? <HrLayout session={session} /> : <Navigate to={`/${role}`} replace />}
      >
        <Route index element={<Hr.Dashboard />} />
        <Route path="exits" element={<Hr.AllExits />} />
        <Route path="exits/:caseId" element={<Hr.CasePage />} />
        <Route path="escalations" element={<Hr.Escalations />} />
        <Route path="relieving-letters" element={<Hr.RelievingLetters />} />
        <Route path="insights" element={<Hr.Insights />} />
        <Route path="risk-and-rehire" element={<Hr.RiskAndRehire />} />
        <Route path="exit-interviews" element={<Hr.ExitInterviews />} />
        <Route path="agents" element={<Hr.Agents />} />
        <Route path="all-exits" element={<Navigate to="/hr/exits" replace />} />
        <Route path="risk-and-compliance" element={<Navigate to="/hr/risk-and-rehire" replace />} />
        <Route path="trends" element={<Navigate to="/hr" replace />} />
        <Route path="clearances" element={<Navigate to="/hr/relieving-letters" replace />} />
        <Route path="policy-audit" element={<Navigate to="/hr" replace />} />
        <Route path="workflow-optimization" element={<Navigate to="/hr" replace />} />
        <Route path="reports" element={<Navigate to="/hr" replace />} />
        <Route path="agent-activity" element={<Navigate to="/hr/agents" replace />} />
        <Route path="settings" element={<Navigate to="/hr" replace />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Route>

      <Route
        path="/finance"
        element={role === 'finance' ? <FinanceLayout session={session} /> : <Navigate to={`/${role}`} replace />}
      >
        <Route index element={<Finance.Dashboard />} />
        <Route path="help" element={<HelpPage role="Finance" />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Route>

      <Route path="*" element={<Navigate to={`/${role}`} replace />} />
    </Routes>
  )
}
