// Loaded from the administrator-managed profiles table, never from editable user metadata.
export const canEdit = (user, report) =>
  user?.staffRole === 'creator' &&
  (!report || (report.status === 'draft' && report.created_by === user.id))
export const canHodApprove = (user) => user?.staffRole === 'hod'
export const canCfoApprove = (user) => user?.staffRole === 'cfo'
export const canWithdraw = (user, report) => user?.staffRole === 'creator' &&
  report?.created_by === user.id && ['submitted', 'hod_approved', 'cfo_approved'].includes(report.status)
