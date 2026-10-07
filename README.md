# Petty Cash System — Tabba Heart Institute

React/Vite application for the FMES department. Aftab and Idrees share one department cash balance. Staff profiles control creator, HOD, and CFO access.

## Setup

Requires Node.js 22.12 or newer (Node 22 LTS is used in CI).

1. Install dependencies with npm ci --ignore-scripts.
2. Copy .env.example to .env and set the Supabase project URL and public anon key. Never put an administrator/service-role key in frontend configuration.
3. Follow [database setup](SUPABASE_RLS_GUIDE.md) before starting this version. The migration creates a new database or upgrades the expected existing schema, replaces unsafe policies, and installs transactional functions. Deployed schema compatibility and legacy ownership require administrator verification.
4. Run npm run dev. Run npm run build for a production build and npm run preview to inspect it.

## Workflow

- Creators create a report or edit their own draft. Submitted By comes from their authenticated staff profile.
- Header and items are validated and saved atomically. Failed or retried requests cannot leave partial reports or duplicate the same request.
- Submission checks the latest shared opening balance. Use Refresh opening balance if another creator has submitted a report meanwhile.
- The HOD reviews submitted reports; the CFO reviews HOD-approved reports. Financial content is immutable after submission.
- The dashboard paginates and filters reports. Summary amounts exclude drafts and cover all reports, not just the current page.
- Report detail requires successful header, item, and history loads. Inconsistent reports cannot be exported.
- PDF exports include report ID, status, readable tables with repeated headers, and recorded approval history.

## Excel import and export

Open **Excel import / export** from the dashboard. All active staff can download an `.xlsx` containing all accessible reports and their expense lines, including drafts. Export ignores dashboard filters, paginates beyond the API row limit, and includes numeric PKR amounts, status, owner, report ID, revision and export time. Opening/closing balances are per report and must not be summed. Each report and its items are read together; a long export can span concurrent changes to different reports.

Creators can download the import template, replace the example records, and fill **Reports** (one row per report) and **Items** (one row per expense). Match **Report Key** between sheets. Use `YYYY-MM-DD` or Excel dates, supported sections, and numeric amounts with at most two decimals. Upload `.xlsx` files up to 2 MB, with at most 50 reports and 100 expenses per report. A worker validates the workbook before showing a preview; formulas and special cells are rejected.

Confirm **Import reports as drafts** to save the entire workbook in one transaction. The signed-in creator owns the drafts. Review each draft and refresh its opening balance before submitting through the existing approval workflow. Imports cannot overwrite existing reports, set approval status, change ownership or directly change the shared balance. Identical keys and normalized contents uploaded by the same account reuse deterministic request IDs, including after a lost response or page reload. Changing a key or contents creates a new draft. Exports are reference workbooks; use the separate template for imports.

Apply `supabase/migrations/202610050002_excel_import.sql` before deploying the Excel UI. ExcelJS is loaded with the Excel page; its compatible UUID dependency is pinned to 11.1.1 to address the published advisory.

Workbook import validates the complete ZIP directory, rejects inconsistent entry counts and overlapping data, and checks actual decompressed bytes with a 20 MiB budget in 16 KiB chunks. Entry lengths and CRCs must match. ExcelJS receives a rebuilt, uncompressed archive containing only verified entries; attacker-supplied ZIP metadata never reaches its decompressor. The worker timeout remains a separate processing-time limit.

## Checks

Creators can delete their own drafts; administrators can delete any draft from the dashboard or report details. Apply `202610070003_delete_drafts.sql` before deploying this UI. Deletion removes the report, items and history from staff reads and Excel exports, while retaining them in the database with the deleting actor and timestamp. Submitted reports must be withdrawn first. Revision checks prevent deleting a report that changed, and safe retries cannot restore deleted reports or report a deleted Excel import as successful. There is no restore option in the app.

Administrator accounts use the administrator-managed `profiles.role = 'admin'` value. They can create/import reports, edit any staff draft without changing its owner, approve at HOD and CFO stages in order, and withdraw the latest submitted/approved report. Submitted financial fields remain locked until withdrawal. Existing revision checks, shared-balance rules and audit history still apply. Administrator actions are recorded under the administrator's identity. Apply `202610070002_administrator_role.sql` before assigning this role; passwords are managed in Supabase Auth and never stored in this repository.

- npm test — PostgreSQL authorization/transaction tests plus money, calendar, grouping, and PDF tests.
- npm run lint — lint warnings and errors fail the command.
- npm run test:browser — browser regression tests with mocked Supabase responses; no live backend writes.
- npm run build — production build.
- npm audit — dependency advisory check.

For browser tests, install Chromium using npx playwright install chromium. Windows users with Edge can set PLAYWRIGHT_CHANNEL=msedge instead. The test server uses fake Supabase configuration and intercepts every external request.

GitHub Actions runs clean installation, lint, unit/database tests, build, and Chromium browser tests on pushes and pull requests. The existing repository is https://github.com/mirza9037/petty-cash-app.

## Project layout

- src/pages — login, paginated dashboard, create/edit form, detail.
- src/lib — shared validation, money/calendar helpers, data API, role checks, lazy-loaded PDF generation.
- src/components — navigation and application error boundary.
- src/index.css — shared design tokens and responsive page styles.
- supabase/migrations — versioned database schema, policies, transactions, and approval functions.
- supabase/preflight.sql — read-only checks for the deployed schema and legacy data.
- tests — database, unit, PDF, and browser regression tests.

## Deployment

Use Vercel with the two public VITE_ variables configured. Apply the database migration first and deploy the frontend in the same maintenance window. Confirm SPA routing, staff access, and the complete approval workflow in staging. See [database setup](SUPABASE_RLS_GUIDE.md) for legacy data reconciliation and rollback considerations.

## Remaining product decisions

Creators can use **Withdraw to draft** on their own submitted, HOD-approved or CFO-approved reports, from the dashboard or report details. Only the latest report in the shared ledger can be withdrawn; later reports must not depend on its closing balance. Confirmation removes its effect from department summaries and returns it to the draft editor. Previous approval events remain in history with an immutable snapshot of the submitted header and expense rows. Resubmission requires fresh HOD/CFO approvals. Stale actions fail; retrying a completed withdrawal does not create duplicate history or withdraw a later resubmission. Apply `202610070001_withdraw_reports.sql` before deploying this UI.

Storing receipt attachments still requires workflow/storage requirements. Standard PDF fonts cover the current English report layout; multilingual exports need an appropriate embedded font.

Internal system — authorized personnel only.
