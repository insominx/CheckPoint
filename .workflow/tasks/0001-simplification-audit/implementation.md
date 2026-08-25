# Implementation Record

Last Edited: 2026-08-25

## Contract as-executed

- Spec source: `plan.md`
- Behavior delivered:
  - Linked Sheets targets distinguish accessible, confirmed missing, and errors; only no id or 404 creates a replacement.
  - History and Session lifecycle state is keyed to request/class identity; late work cannot render or persist into another scope, and failed automatic draws expose Retry.
  - `selectedClass` is the sole runtime class authority and one `inFlight` key excludes overlapping long operations and class switches.
  - `PerClassSettings.defaultN` is the sole local persisted authority; Dexie v3 migrates legacy class values and Sheets retains a derived compatibility cell.
  - Draft redraw has one `redrawFrom` mode; VitePWA is the sole manifest owner.
- Non-goals honored: no backend/automatic sync, no Sheets schema break, no operation compatibility matrix, no permanent legacy `ClassEntity.defaultN` shim.

## Execution decision audit

- Result: `execution-decisions.md`
- Ledger path: `.workflow/tasks/0001-simplification-audit/execution-decisions.md`
- Summary: D1 substitutes pure-state plus real-browser proof for unavailable jsdom/fake-indexeddb packages; D2 adds an owned E2E runner to satisfy the clean-exit gate.

## Authority and change map (as-built)

- Owner: `web/src/store.ts::useStore` for runtime scope/operations; `web/src/data/db.ts` and `repository.ts` for persistence; service/page/domain files for their local boundaries.
- Decision point: store admission and captured identity checks; raw Sheets HTTP classification; Dexie v3 upgrade; request/class-keyed page state.
- Files changed:
  - `web/src/services/sheetsClient.ts`, `sheetsSync.ts` — explicit probe and settings-derived sheet projection.
  - `web/src/store.ts` and page readers — canonical selected class, stale-commit guards, exclusive `inFlight`.
  - `web/src/data/db.ts`, `repository.ts`, `types.ts` — v3 settings migration and removal of class-row `defaultN`.
  - `web/src/pages/History.tsx`, `historyExpansion.ts`, `Session.tsx`, `sessionDraw.ts` — keyed lifecycle state and retry UI.
  - `web/src/domain/sessionDraft.ts` — two-mode fresh/redraw builder.
  - `web/vite.config.ts`, `web/public/manifest.webmanifest`, `web/.gitignore` — one PWA manifest owner and generated dev output hygiene.
  - `web/playwright.config.ts`, `web/package.json`, `web/e2e/run.mjs` — cleanly terminating E2E runner.
  - `web/src/**/*.test.ts`, `web/e2e/*.spec.ts`, `web/e2e/fixtures/roster-b.csv` — boundary, migration, lifecycle, and regression proof.
  - `docs/product/prd.md`, `docs/product/design-overview.md` — corrected data authority, paths, symbols, and test inventory.

## Acceptance / evidence

| check | status | evidence | gap |
|---|---|---|---|
| AC1 Sheets target safety | verified | 12 client/sync tests classify 200/204/404/errors and create/overwrite policy; `store.test.ts` proves export failure never persists a replacement id. | none |
| AC2 Request-keyed UI state | verified | History rows/details now require matching class/request generations; Session student info rejects late class/unmount results; class-switch E2E proves mounted A→B and reload. | jsdom component proof replaced per D1 |
| AC3 Store scope/exclusivity | verified | 11 store tests cover selection restore/order, StrictMode init, autosave identity, stale pick/save, same-id mutation, delete/operation overlap, switch admission, release, and failed export persistence. | none |
| AC4 Single defaultN authority | verified | Browser tests prove legacy-only, settings-wins, class-row cleanup, metadata preservation, atomic new-class settings, and lossless concurrent partial updates; sync tests prove both exported cells use settings. | fake-indexeddb proof replaced per D1 |
| AC5 Simplification regression | verified | 86/86 unit tests, lint, build, and 5/5 Chromium tests all exit 0; post-E2E lint also passes with generated PWA output present. | none |

## Verification record

- Verified:
  - `npm run test:run` — exit 0; 10 files, 86 tests passed.
  - `npm run lint` — exit 0.
  - `npm run build` — exit 0; `dist/manifest.webmanifest` generated with dark colors, standalone display, `/` start URL, and two logo icons.
  - `npm run e2e` — exit 0; 5 Chromium tests passed in 2.7s, including clean runner shutdown and concurrent settings updates.
  - `npm run lint` after E2E — exit 0 with generated `dev-dist` present.
  - Focused browser checkpoint — exit 0; PWA, migration, and mounted class-switch specs 3/3 passed.
  - `git diff --check` — exit 0.
- Not verified: destructive live-Google error scenarios and cross-browser PWA installation, per plan.
- Failed: none remaining. The initial E2E shutdown hang and incorrect native-version migration fixture were fixed and rerun green.

## Change control record

- Checkpoints used: Phases 1, 2–4, 5, 6–7, 8, then full unit/lint/build/E2E.
- Mixed feature/refactor/debug batches: production slices stayed phase-scoped; D2 runner repair was isolated after reproducing AC5 failure.
- Diff reviewability: stale-symbol scan and final `git diff --check` passed; the user's untracked root `package-lock.json` was not modified.
- Rollback/resume anchor: revert by phase using the owner/test group above; do not roll back only the Dexie v3 migration without retaining migrated settings rows.

## Discovered risks / debt

| finding | severity | recommendation |
|---|---|---|
| jsdom/testing-library and fake-indexeddb are not installed in the restricted environment. | low | Optionally add those duplicate proof layers later; current Vitest policies plus real Chromium boundaries cover acceptance. |
| Browserslist data reports as 12 months old during build/E2E. | low | Refresh dependency metadata in a network-enabled maintenance pass. |

## Resume anchors

- Contract: `.workflow/tasks/0001-simplification-audit/plan.md`
- Decisions: `.workflow/tasks/0001-simplification-audit/execution-decisions.md`
- Primary commands: `cd web; npm run test:run; npm run lint; npm run build; npm run e2e`
