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

After `202610070002_administrator_role.sql`, `admin` is also an allowed profile role. It combines creator, HOD and CFO capabilities and permits editing/withdrawing other staff reports. It does not grant direct database writes, bypass approval order or permit withdrawal of older ledger entries. Report ownership remains unchanged when an administrator edits a staff draft; events identify the administrator as the actor. Request recovery remains restricted to the request actor. Create the Auth account through the server-side admin API, then explicitly assign its profile using an administrator database connection. Never grant this role from user-editable metadata.

Restrict public signup in Supabase Auth to your organization’s onboarding process. Even if signup is enabled, new accounts without active profiles receive no application data access.

## Verification

Run npm test. The database tests execute the real migration in isolated PGlite PostgreSQL, with auth.uid() and authenticated/anonymous roles supplied by the test harness. They test direct-write denial, approval bypasses, rollback, ownership, stale edits, retries, and shared balances. This is not a substitute for inspecting the deployed database or testing its existing triggers/functions.

Do not use a Supabase service-role key in VITE_ environment variables. The frontend needs only the project URL and public anon/publishable key.

## Deployment verification

After linking the CLI, run `supabase db query --linked --file supabase/verify-deployment.sql`. It checks real database permissions, existing triggers, shared balances, draft editing, retries, and approval history using the four configured staff profiles. All test writes occur inside one transaction and are rolled back. Run in a maintenance window because the shared balance lock temporarily blocks other submissions.

Both migrations and this verification passed on the production project on 1 October 2026. The database had no existing reports or items, so no legacy ownership reconciliation was needed.

## Recovery and future-date migration

Apply migrations in filename order, including 202610050001_recovery_and_submission_dates.sql. This replaces the save RPC to reject future submitted dates and adds the owner-restricted resolve_report_save RPC. It checks or cancels an uncertain request while holding the same advisory lock used by saving. Cancellation records stop late retries. No financial records are deleted when a request is discarded.

Before rollout, check for existing non-draft reports dated beyond the current Karachi date. If any exist, reconcile those dates against source records; the migration intentionally does not rewrite historical reports. Apply this migration before the updated frontend and run verify-deployment.sql.

## Excel import migration

Apply `202610050002_excel_import.sql` before deploying the Excel transfer page. `import_expense_reports` is a security-invoker RPC restricted to authenticated, active creators. It accepts 1–50 new drafts, rejects repeated request/report IDs, and calls the existing save function inside one transaction. It supplies no expected revision, so it cannot overwrite existing reports. Ownership, totals, audit events and idempotency remain enforced by `save_expense_report`. No table permissions or read policies change.

Run `supabase db query --linked --file supabase/verify-excel.sql` after applying the migration. It verifies draft ownership, numeric totals, retry behavior, all-or-nothing rollback and approver denial, then rolls back all test records. Excel exports use the user's existing RLS-scoped connection, fetching reports with nested items and keyset pagination.

## Historical Excel uploads

Apply `202610070004_historical_excel.sql` after all earlier migrations. `import_historical_reports` requires an active creator or administrator and accepts at most 500 reports / 10,000 expense rows, with 1–100 rows per report. It validates historical dates, sections, money precision and totals, computes closing balances, and inserts immutable reports with status `historical`, the uploader's identity and an audit event. It never updates existing reports or invents approval events. A private receipt table binds retry IDs to actor and full content, with sorted transaction locks. Whole uploads roll back on any failure.

Historical records use existing staff read policies and direct-write restrictions. They are excluded from shared balance, monthly submitted spending and pending approvals; existing save, approval, withdrawal and draft-deletion functions cannot change them. Report date indexes support filters across years. Verify with `supabase db query --linked --file supabase/verify-historical-excel.sql`; all test writes are rolled back.

Apply `202610080001_delete_historical.sql` to allow any active staff role to delete an individual historical record through `delete_historical_report`. It checks the report's status and revision, records the actor and deletion timestamp, and hides the report, items and events from staff reads and Excel exports. Current balances and approvals are untouched. The original upload receipt remains private, and retrying it cannot make a deleted record appear again. Verify with `supabase/verify-delete-historical.sql` before deploying the matching UI.

## Creator withdrawal

Apply `202610070001_withdraw_reports.sql`. Per the requested workflow, active creators can withdraw their own reports even after CFO approval, but only while the report is the latest non-draft entry in the shared ledger. The RPC locks the report, verifies its revision and owner, then takes the same ledger lock used by submission. It changes status to draft without changing financial fields, clears the submission timestamp, advances the revision, and records the prior report and items in `report_events.report_snapshot`, all in one transaction. Existing client write restrictions protect these snapshots.

Withdrawal removes the report from the existing department summary calculations. When no submitted reports remain, the balance becomes “Not yet recorded”; the draft retains its opening balance. Reports must be submitted and approved again. A retry with the original revision only succeeds while the resulting withdrawal revision is still current. Old approvals remain historical and are excluded from current signature labels. Run `supabase db query --linked --file supabase/verify-withdraw.sql` for a rollback-only production verification.
