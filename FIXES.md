# Review fixes — 1 October 2026

All 13 findings have been addressed. **Both database migrations were applied to the live Supabase project on 1 October 2026.** The CLI is linked, all four staff profiles are active, and production database checks passed in a transaction that was rolled back. No synthetic reports were retained.

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
- Database/unit/PDF tests: **16 passed**. Database tests run the actual migration in isolated PostgreSQL through PGlite, including rollback after a forced late insert failure, unauthorized writes, role transitions, ownership, stale edits, idempotency, and shared balances.
- Browser tests: **8 passed** in headless Edge, with all external API requests intercepted. Covers invalid input, draft editing, lost-response recovery across reload, failed report/item loads, approvals, role restrictions, mobile width, and PDF download.
- Lint: passed with warnings treated as errors.
- Production build: passed. The initial application JavaScript chunk is about **443 kB**, down from about **1,189 kB** during the review. PDF code loads on export; exact output sizes depend on dependency versions and minification.
- Dependency audit: **0 vulnerabilities** across production and development dependencies at verification time.
- Visual export check: inspected an eight-page, 100-item PDF, including repeated headers, subtotals, final total, history, signatures, and page numbers; no clipping or overlap observed.
- Live verification additionally exercised the deployed triggers, draft edits, idempotent retry, shared balance, ownership, direct-write denial, HOD/CFO transitions, outsider read denial, and audit history. Synthetic records were rolled back.
- The live schema used a generated closing-balance column. A second migration retains its values as a normal numeric column so the atomic save function can write it; a regression test covers this upgrade.

## Deployment status

The preflight found no existing reports or items and confirmed all four staff accounts. Existing triggers and privileged functions were inspected. An application data/schema snapshot was saved locally outside Git before applying both migrations. The linked migration history is current. See [SUPABASE_RLS_GUIDE.md](SUPABASE_RLS_GUIDE.md) for setup of other environments.

No legacy ownership reconciliation was needed in this project because the report tables were empty. Other installations with historical reports must still reconcile ownership and amounts before approving them.

Live signup settings still require a separate administration review. Existing public functions, triggers, and views were inspected during deployment. Rejection/return-for-correction and receipt attachments remain product decisions, as identified in the review. Multilingual PDF text needs a suitable embedded font; the current export supports the existing English layout.
