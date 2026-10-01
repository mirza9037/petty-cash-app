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

## Checks

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

Returning a submitted report for correction and storing receipt attachments require workflow/storage requirements. They are not silently enabled by this release. Standard PDF fonts cover the current English report layout; multilingual exports need an appropriate embedded font.

Internal system — authorized personnel only.
