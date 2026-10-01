# Petty Cash App — project review

> This is the original review. The subsequent implementation and verification status is recorded in [FIXES.md](FIXES.md). All 13 findings have local code fixes; the database migration still requires deployment and legacy-data reconciliation.

Reviewed 1 October 2026. Scope: all application source, assets, package manifests, deployment configuration, README, and the Supabase policy guide. Functional and security reviews were performed by separate general review agents because the dedicated Bugbot/Security Review tools were unavailable.

## Assessment

Fix authorization and report persistence before relying on this app for expense approvals. The main risks are bypassed approvals, changes to approved financial records, and incomplete or duplicate reports. Draft editing is also missing despite being advertised.

**Important scope limit:** security findings below concern the SQL supplied in `SUPABASE_RLS_GUIDE.md`. Deployed policies, grants, schema constraints, triggers, and signup settings were not inspected. Additional deployed protections may change exploitability. Browser checks used intercepted API responses and fake sessions; they made no live database writes.

P1 means address before operational use; P2 means fix in the next reliability pass.

## Findings

### F1 · P1 · UPDATE policies allow approval bypass

**Location:** [SUPABASE_RLS_GUIDE.md:50](SUPABASE_RLS_GUIDE.md), lines 50–78.

The creator, HOD, and CFO policies all apply to `authenticated`. Roles are checked in `USING`, while `WITH CHECK` checks only the destination status. A creator's draft passes the creator's existing-row check; changing its status directly to `cfo_approved` passes the CFO's destination check. HOD can also skip CFO approval.

PostgreSQL combines permissive policies with OR, so these policies do not form isolated transition pairs. Include role checks in every destination predicate and enforce allowed transitions in a database function or trigger. Add negative tests for each role and transition. See [PostgreSQL policy semantics](https://www.postgresql.org/docs/current/sql-createpolicy.html).

### F2 · P1 · Creators can insert already-approved reports

**Location:** `SUPABASE_RLS_GUIDE.md:33–39`.

The insert policy checks only the creator email. A direct API insert can provide `status: 'cfo_approved'`, bypassing the browser's validation and both approvers. Restrict initial status at the database boundary and assign ownership from `auth.uid()`.

### F3 · P1 · Creators can append expenses after approval

**Location:** `SUPABASE_RLS_GUIDE.md:98–104`.

Item insertion checks only the caller's email. It does not check the parent report's owner or status. A creator can append items to a submitted or CFO-approved report. This changes the approved detail and can make item sums disagree with stored report totals.

Require an editable parent owned by the caller. Save header and items together, then submit as the last step of the same transaction. Simply restricting item insertion to drafts would break today's flow, which inserts a submitted header before inserting its items.

### F4 · P1 · Approval permissions also permit financial edits

**Location:** `SUPABASE_RLS_GUIDE.md:55–78`.

Even after fixing F1, approver UPDATE policies authorize the entire row. An approval request can also change cash received, expenses, balance, date, or submitter. Enforce immutable report content after submission. Expose a narrow approval function, restrict direct writes, and record the authenticated approver and timestamp.

### F5 · P1 · Failed saves leave partial reports; retries create duplicates

**Location:** `src/pages/NewReport.jsx:107–141`.

The header is inserted before line-item validation. In the browser test, submitting the initial empty description produced one report write, zero item writes, and a validation error. Correcting the description and retrying produced a second report write. An item-insert failure has the same partial-save problem, and no rollback or resume mechanism exists.

Validate every input before any write. Use one database transaction/RPC to save header and items, calculate totals on the server, and transition status. Add an idempotency key for retries. Include network-failure and repeated-submit tests.

### F6 · P1 · Saved drafts cannot be edited or submitted

**Location:** `src/pages/Dashboard.jsx:417–423`; routes in `src/App.jsx:70–85`.

The Edit button opens the same detail route as View. That page has no editable controls or submit action. The browser test confirmed zero input/select/textarea controls after clicking Edit. Save as Draft therefore strands the report in a workflow users cannot finish.

Add a draft editor that loads and updates the existing report ID, supports item changes, and submits through the transaction described in F5. Enforce ownership and draft status in the database as well as the UI.

### F7 · P2 · Clean dependency installation fails

**Location:** `package.json:19`; dependency list in `package-lock.json:10–17`.

`zod` is declared in the manifest and imported by validation code but is absent from the lockfile. Executed `npm ci` fails with `Missing: zod@3.25.76 from lock file`. Regenerate and commit a consistent lockfile, then use clean installation in CI. This behavior is documented by [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

### F8 · P2 · Failed item loading produces an exportable incomplete report

**Location:** `src/pages/ReportDetail.jsx:45–52`.

The fetch handler checks the report response but ignores `itemsRes.error`. A mocked item API failure left the stored grand total visible and PDF export enabled, with no load error. Require both requests to succeed and show a retry state before enabling export.

### F9 · P2 · Dashboard hides read and approval failures

**Location:** `src/pages/Dashboard.jsx:38–45` and `77–87`.

A failed initial query stops loading and renders “No expense reports yet” with zero balances. This was reproduced in the browser. Approval errors are also discarded; successful HTTP responses do not prove a row was changed when authorization or stale state filters it out.

Show read and mutation errors separately. Preserve known data on refresh failure. Require a returned updated row, check the expected previous status server-side, and explain conflicts to the user.

### F10 · P2 · “Own drafts” policies do not check ownership

**Location:** `SUPABASE_RLS_GUIDE.md:46–49` and `112–117`; `src/pages/NewReport.jsx:87–97`.

Both creator accounts can update either creator's drafts and items under the supplied policies. The payload contains a selectable display name, not an authenticated owner. If the guide's “own drafts” rule is intended, add immutable `created_by` and enforce it against `auth.uid()`. If shared editing is intended, document that rule explicitly and still record who created and changed each report.

### F11 · P2 · Monetary inputs allow inconsistent displayed totals

**Location:** `src/lib/validation.js:71–74`; `src/pages/NewReport.jsx:39–40`.

The actual schema accepts `0.004`. Two such items display as `0.00` each, while the summed total displays as `0.01`. This was reproduced with the project's validation schema. Reject precision beyond two decimal places and use integer paisa or fixed-precision decimal arithmetic consistently. Apply the same rules to opening balance and received cash, including database constraints.

### F12 · P2 · Default report date is wrong early in the Karachi day

**Location:** `src/pages/NewReport.jsx:10`.

`toISOString()` uses UTC. At `2026-10-01 01:00 +05:00`, the default becomes `2026-09-30`; the issue occurs from midnight through 04:59 in Karachi. Build a local calendar date or explicitly use the organization's timezone. Test month boundaries.

### F13 · P2 · Certain stored section names crash report viewing

**Location:** `src/pages/ReportDetail.jsx:60–68`.

The grouping dictionary is `{}`. Keys such as `constructor`, `toString`, and `__proto__` match inherited properties, so initialization is skipped and `.items.push()` throws. These values pass the supplied section validation, although normal dropdown choices do not generate them. Reproduction ran the grouping logic locally. Use `Map`, as NewReport already does, and constrain section values on the server.

## Accounting and deployment questions to resolve

- **Outstanding balance meaning:** the dashboard sums all closing balances (`Dashboard.jsx:53–55`). If reports carry balances forward, closing balances of 800 followed by 700 produce 1,500 on the dashboard even though the current balance is 700. Define the cash account/custodian model and show the latest posted balance per independent account.
- **Draft inclusion:** monthly expenses and total outstanding include drafts. Decide whether these cards represent posted activity or work in progress and label/filter accordingly.
- **Read access:** the supplied SELECT policies let every authenticated account read all reports and items. Confirm that every admitted account is authorized for financial access and verify signup restrictions.
- **Actual backend protection:** inspect deployed policies, grants, numeric constraints, foreign keys, triggers, and existing permissive policies. Adding new policies does not replace old ones. Put the authoritative schema and policies in versioned migrations with authorization tests; see [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Improvements after the correctness fixes

1. **Automated checks:** no tests or CI workflow are included. Add meaningful coverage for atomic saves, draft completion, role/ownership denial, approval transitions, API failures, and date/money boundaries. Run clean install, build, lint, and database tests in CI.
2. **Approval history:** store actor, timestamp, previous/new status, and a report revision. Discuss rejection/return-for-correction and receipt attachments as product requirements.
3. **Dashboard growth:** paginate reports and calculate summaries in the database. The current single query and client-side sums can become incomplete when API row limits are reached. Add date/status filters and search.
4. **Initial load:** route imports load PDF dependencies eagerly. The measured production entry chunk was 1,188.59 kB, or 339.62 kB gzip. Lazy-load report detail and PDF tools, then measure again.
5. **PDF layout:** use a fixed print width, repeat table headers, and split at row/section boundaries. The current pixel slicing can cut rows or signature blocks. Verify long descriptions, 100 items, and mobile exports. Do not present an unapproved draft as indistinguishable from an approved report; print status and report ID.
6. **Form usability/accessibility:** label table inputs and balance fields, identify the failing row, cap Add Row at 100, default submitter to the signed-in staff member, add cancel/back navigation, and warn about unsaved edits. Verify navbar and form overflow on narrow screens.
7. **Maintainability:** extract shared colors, formatting functions, status definitions, and repeated styles; separate data operations from page rendering. Move roles from hardcoded email lists to a trusted role source when administration requires it.
8. **Configuration and assets:** validate required environment variables with a clear startup error, handle authentication initialization/logout failures, and use bundled logos instead of third-party image requests. Document Node requirements and complete database setup.

## Verification results

- Clean installation: **failed**, missing Zod lockfile entry.
- Dependency installation for verification: succeeded using `npm install --package-lock=false --ignore-scripts`. This resolved newer versions allowed by the manifest. **The subsequent build/lint/browser results do not establish that the original locked dependency set works.** The original manifest and lockfile were not edited.
- Production build: passed using Vite 8.3.1, with the large-chunk warning above.
- Lint: completed with five warnings: two unused Login state bindings, one unused NewReport parameter, and two Dashboard React warnings. No lint errors were reported.
- Browser smoke test: the local development login rendered without captured browser errors in headless Edge.
- Browser workflow tests: reproduced F5, F6, F8, and dashboard-read portion of F9 against mocked API responses.
- Direct checks: reproduced fractional-paisa acceptance, Karachi date error, and inherited section-key crashes.
- Lockfile audit: two advisories, one high-severity development dependency and one low-severity optional dependency. `nanoid` 3.3.17 is development-only through PostCSS; [its advisory](https://github.com/advisories/GHSA-2v37-7h3g-55p8) concerns zero-size custom generators. DOMPurify 3.4.13 is optional through jsPDF; [its advisory](https://github.com/advisories/GHSA-p98j-92pf-mc4p) requires in-place sanitization with node-removing hooks. Those attack paths were not identified in application source. Refresh affected dependencies and the lockfile; do not interpret audit severity as proof of a reachable application exploit.
- At the time of the initial review, the supplied folder had no Git metadata. It was subsequently connected to the existing GitHub repository before preparing the fixes for deployment.
- No application source was changed. Local dependency/build outputs and this review were created for verification and delivery.

## Recommended sequence

1. Fix and test database authorization, ownership, immutable financial fields, and approval transitions.
2. Implement atomic report saves and a working draft editor together.
3. Repair the lockfile and add CI plus regression tests for the demonstrated failures.
4. Correct error handling, currency/date behavior, and summary semantics.
5. Improve PDF output, accessibility, performance, and maintainability.
