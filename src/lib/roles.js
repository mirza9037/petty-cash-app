// Loaded from the administrator-managed profiles table, never from editable user metadata.
export const canEdit = (user, report) =>
  ['creator', 'admin'].includes(user?.staffRole) &&
  (!report || (report.status === 'draft' && (report.created_by === user.id || user.staffRole === 'admin')))
export const canHodApprove = (user) => ['hod', 'admin'].includes(user?.staffRole)
export const canCfoApprove = (user) => ['cfo', 'admin'].includes(user?.staffRole)
export const canWithdraw = (user, report) => ['creator', 'admin'].includes(user?.staffRole) &&
  (report?.created_by === user.id || user?.staffRole === 'admin') && ['submitted', 'hod_approved', 'cfo_approved'].includes(report?.status)
