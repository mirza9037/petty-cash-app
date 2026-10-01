# Database setup and authorization

The authoritative schema and access rules are in [202610010001_secure_reports.sql](supabase/migrations/202610010001_secure_reports.sql). Apply [202610010002_normalize_closing_balance.sql](supabase/migrations/202610010002_normalize_closing_balance.sql) afterward to support older installations with a generated closing-balance column. Existing values are preserved. The old email-based UPDATE and INSERT policies are replaced completely.

## Deployment order

1. Back up the database using the project’s normal backup process.
2. Run [preflight.sql](supabase/preflight.sql) in Supabase SQL Editor and inspect the results. Existing report/item IDs must be UUIDs; report_date must be a date; status must be text; monetary fields must be numeric; created_at must be timestamptz. If the deployed schema differs, adapt the migration against a staging copy before applying it. Inspect generated-column metadata as well; the second migration normalizes older generated closing balances.
3. Apply both migrations in filename order as the database owner, or use `supabase db push --linked`. It is transactional: a failure rolls back the migration. It deliberately removes old policies on the five application tables and revokes direct client writes. Review any other existing SECURITY DEFINER functions returned by preflight: old write RPCs must be removed or secured too.
4. Confirm the four existing staff auth accounts have active profiles. Profiles are seeded only when the corresponding auth user already exists. Additional staff must be provisioned by an administrator; users cannot assign themselves roles.
5. Reconcile legacy report ownership and incorrect amounts against reliable records. Existing names came from a client dropdown and are not reliable ownership evidence. The migration leaves created_by NULL for old records. These records remain readable to staff, but cannot be edited or approved until an administrator assigns verified ownership. Do not mass-assign owners solely from submitted_by.
6. Deploy the matching frontend only after the migration succeeds. The old frontend relies on direct writes and will no longer save or approve after this migration. Schedule the backend/frontend release together.
7. Smoke-test creator → draft → edit → submit → HOD approval → CFO approval in staging, then verify production with authorized test data. Confirm outside accounts cannot read reports.

Do not deploy only the frontend: it requires the new profiles table and RPC functions.

## Rules enforced by the database

- Only active profiles can read reports, items, history, or department summaries.
- Each draft belongs to an immutable authenticated user UUID. Display names never authorize writes.
- Client roles have SELECT access only. No INSERT, UPDATE, or DELETE policy is granted on report data.
- save_expense_report validates all fields and 1–100 items, enforces two-decimal amounts, derives identity and totals server-side, and saves the entire report in one transaction.
- Request UUIDs make an identical retry return the previous result. Reusing a request UUID for different data fails. Stable client report UUIDs also prevent a changed retry from creating a second report.
- A draft edit requires its expected revision. A stale browser tab fails instead of overwriting newer changes.
- Only an HOD can move submitted → hod_approved. Only a CFO can move hod_approved → cfo_approved. Approval functions accept no financial-field arguments.
- Submitted content is immutable to client accounts. Approval events record the actor, timestamp, status, and revision.
- Both creators share one department balance. Submitting a report serializes balance checks, requires the current opening balance, and prevents dates preceding the latest submitted report. Drafts do not affect the ledger.
- The department summary uses the latest submitted closing balance and sums submitted monthly expenses in Asia/Karachi. It covers the whole database, independent of dashboard pagination.

## Staff administration

Manage public.profiles only through an administrator connection. Its id must match auth.users.id, role must be creator, hod, or cfo, and active controls access. Set display_name to the staff member’s verified name. Disable active before removing access; an email change does not change the user’s role.

Restrict public signup in Supabase Auth to your organization’s onboarding process. Even if signup is enabled, new accounts without active profiles receive no application data access.

## Verification

Run npm test. The database tests execute the real migration in isolated PGlite PostgreSQL, with auth.uid() and authenticated/anonymous roles supplied by the test harness. They test direct-write denial, approval bypasses, rollback, ownership, stale edits, retries, and shared balances. This is not a substitute for inspecting the deployed database or testing its existing triggers/functions.

Do not use a Supabase service-role key in VITE_ environment variables. The frontend needs only the project URL and public anon/publishable key.

## Deployment verification

After linking the CLI, run `supabase db query --linked --file supabase/verify-deployment.sql`. It checks real database permissions, existing triggers, shared balances, draft editing, retries, and approval history using the four configured staff profiles. All test writes occur inside one transaction and are rolled back. Run in a maintenance window because the shared balance lock temporarily blocks other submissions.

Both migrations and this verification passed on the production project on 1 October 2026. The database had no existing reports or items, so no legacy ownership reconciliation was needed.
