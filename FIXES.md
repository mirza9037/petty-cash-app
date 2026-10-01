# Review fixes — 1 October 2026

All 13 findings have been addressed in the local project. **Database protections are not active in the live Supabase project until the migration is applied.** This workspace supplies only public frontend credentials, and no Supabase administration connection is configured.

## Fixes, in review order

1. **F1 — Approval bypass:** removed permissive write policies and direct client writes. A dedicated function permits only HOD approval of submitted reports and CFO approval of HOD-approved reports.
2. **F2 — Approved report insertion:** the save function accepts only draft/submitted status and derives ownership from the authenticated UUID.
3. **F3 — Expenses added after approval:** all report/item changes go through an owner-checked draft save. Submitted financial content is immutable to client accounts.
4. **F4 — Financial changes during approval:** the approval function accepts only report ID, expected revision, and destination status. Actor, timestamp, revision, and status are recorded in report history.
5. **F5 — Partial saves and duplicates:** validate before any request; save header/items in one database transaction; calculate totals server-side. Request IDs support safe retries, and stable report IDs prevent a changed retry from creating another report. Pending new-report requests survive page reload in session storage.
6. **F6 — Broken draft editing:** Edit opens an owner-restricted editor, loads saved items, and updates the same report. Creators can save another draft revision or submit it. Stale revisions are rejected.
7. **F7 — Broken installation:** regenerated the lockfile with Zod, added Node requirements, and confirmed a clean install. Updated the two flagged transitive dependencies; audit reports zero vulnerabilities.
8. **F8 — Incomplete exports:** report, items, and history must all load successfully. Failures show a retry action. Export is disabled if amounts do not reconcile.
9. **F9 — Hidden failures:** dashboard read and approval failures are visible. Empty results are distinct from errors; approvals must return the expected updated record. Requests have timeouts, and stale dashboard/detail responses are ignored.
10. **F10 — Missing ownership:** drafts use immutable created_by UUIDs. UI and server both enforce ownership; role assignment is administered through profiles. Legacy owner IDs are deliberately not guessed from display names.
11. **F11 — Currency precision:** validated amounts use at most two decimals; client arithmetic uses integer paisa and PostgreSQL uses exact numeric arithmetic. Invalid amounts identify the offending row.
12. **F12 — Wrong local date:** report defaults use Asia/Karachi and validate actual calendar dates.
13. **F13 — Grouping crashes:** grouping uses Map so inherited object property names cannot break report viewing. New data is restricted to valid sections on both client and server.

## Additional improvements

- One shared department balance, as requested. Drafts are excluded. Submission locks the shared ledger while checking its opening balance; backdated submissions before the latest report are rejected.
- Database summary totals cover every report. Dashboard results are paginated with status, staff, and date filters.
- Replaced screenshot PDF export with selectable text and paginated tables, repeated headers, report ID/status, page numbers, and approval history.
- Moved repeated page styles into CSS, added shared helpers and design tokens, and lazy-loaded pages and PDF generation.
- Added accessible form labels, 100-item limit, local branding assets, narrow-screen styles, keyboard focus indicators, cancel/back navigation, and unsaved-change warnings for page exit and app back/logout actions.
- Added configuration, authentication, and logout error handling plus an application error boundary.
- Added CI and reproducible database, browser, money, calendar, grouping, and PDF regression tests.

## Verification

- Clean npm installation: passed using the committed lockfile.
- Database/unit/PDF tests: **15 passed**. Database tests run the actual migration in isolated PostgreSQL through PGlite, including rollback after a forced late insert failure, unauthorized writes, role transitions, ownership, stale edits, idempotency, and shared balances.
- Browser tests: **8 passed** in headless Edge, with all external API requests intercepted. Covers invalid input, draft editing, lost-response recovery across reload, failed report/item loads, approvals, role restrictions, mobile width, and PDF download.
- Lint: passed with warnings treated as errors.
- Production build: passed. The initial application JavaScript chunk is about **443 kB**, down from about **1,189 kB** during the review. PDF code loads on export; exact output sizes depend on dependency versions and minification.
- Dependency audit: **0 vulnerabilities** across production and development dependencies at verification time.
- Visual export check: inspected an eight-page, 100-item PDF, including repeated headers, subtotals, final total, history, signatures, and page numbers; no clipping or overlap observed.
- These checks ran locally without live database writes. The repository is connected to the existing GitHub project for deployment; the live database migration remains a separate prerequisite.

## Required deployment work

Follow [SUPABASE_RLS_GUIDE.md](SUPABASE_RLS_GUIDE.md). Run the read-only preflight against the real database, check schema compatibility and existing privileged functions, back up the project, and apply [the migration](supabase/migrations/202610010001_secure_reports.sql) before deploying this frontend.

An administrator must reconcile legacy ownership and any inconsistent historical reports before those reports can be edited or approved. Stage the backend/frontend rollout together: the old frontend's direct writes stop working once the secure migration is applied.

Live signup settings and any existing backend functions/views outside this source tree still require inspection. Rejection/return-for-correction and receipt attachments remain product decisions, as identified in the review. Multilingual PDF text needs a suitable embedded font; the current export supports the existing English layout.
