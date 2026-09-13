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

export default function AppRoutes({ role, session }) {
  return (
    <Routes>
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
        <Route path="all-exits" element={<Hr.AllExits />} />
        <Route path="risk-and-compliance" element={<Hr.RiskAndCompliance />} />
        <Route path="exit-interviews" element={<Hr.ExitInterviews />} />
        <Route path="trends" element={<Hr.Trends />} />
        <Route path="clearances" element={<Hr.Clearances />} />
        <Route path="reports" element={<Hr.Reports />} />
        <Route path="settings" element={<Hr.Settings />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Route>

      <Route path="*" element={<Navigate to={`/${role}`} replace />} />
    </Routes>
  )
}
