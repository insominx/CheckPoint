Last Edited: 2026-08-25

# Targeted Fix Wave

## W1 — store-concurrency-writer

- id: W1
- role: `writer-store-concurrency-and-revision-guards`
- kind: `write`
- owned paths:
  - `web/src/store.ts`
  - `web/src/store.test.ts`
- forbidden paths:
  - `web/src/pages/**`
  - `web/src/data/**`
  - `web/e2e/**`
  - `docs/**`
  - `.workflow/**`
- exact strings:
  - `selectedClass` remains the sole selected-scope field; do not reintroduce `selectedClassId`.
  - `inFlight` remains the exclusive long-operation status; do not reintroduce `busy`.
  - The user-visible blocked error remains `Another operation is already in progress.` where applicable.
- acceptance:
  1. `deleteClass` returns a failed `ActionResult` before repository/localStorage side effects whenever `inFlight !== null`; the selected deleted-class race is impossible.
  2. Save completion removes the draft and clears `currentSession` only when the captured session object is still the current object; a newer immutable update with the same session id survives in memory and localStorage.
  3. Concurrent `selectClass(A)` then `selectClass(B)` calls are generation-keyed so only the latest request may persist selection/settings/draft, regardless of resolution order.
  4. Focused store tests demonstrate all three races with deferred promises and pass.
- verification:
  - `cd web && npm run test:run -- src/store.test.ts`
  - `cd web && npm run lint`
- slug: `gpt-5.6-terra` (user override resolved against live host list)

## W2 — page-request-lifecycle-writer

- id: W2
- role: `writer-history-session-request-generations`
- kind: `write`
- owned paths:
  - `web/src/pages/History.tsx`
  - `web/src/pages/historyExpansion.ts`
  - `web/src/pages/History.test.ts`
  - `web/src/pages/Session.tsx`
  - `web/src/pages/sessionDraw.ts`
  - `web/src/pages/sessionDraw.test.ts`
- forbidden paths:
  - `web/src/store.ts`
  - `web/src/store.test.ts`
  - `web/src/data/**`
  - `web/e2e/**`
  - `docs/**`
  - `.workflow/**`
- exact strings:
  - Retry button label remains `Retry`.
  - Drawing label remains `Drawing students…`.
  - Do not reintroduce `selectedClassId` or split History expansion state.
- acceptance:
  1. History session-row loads are keyed by captured class/request generation; late A cannot overwrite B, including A→B→A.
  2. History detail commits require the captured session to belong to the captured/current class; correction stays bound to the open keyed session.
  3. Session student-info loads ignore late results after class switch or unmount.
  4. Deterministic focused tests prove the request-commit policies and pass; no jsdom dependency is required.
- verification:
  - `cd web && npm run test:run -- src/pages/History.test.ts src/pages/sessionDraw.test.ts`
  - `cd web && npm run lint`
- slug: `gpt-5.6-terra` (user override resolved against live host list)

## W3 — persistence-and-runner-writer

- id: W3
- role: `writer-settings-transaction-and-e2e-lifecycle`
- kind: `write`
- owned paths:
  - `web/src/data/repository.ts`
  - `web/e2e/data-migration.spec.ts`
  - `web/e2e/pwa.spec.ts`
  - `web/e2e/run.mjs`
  - `web/package.json`
  - `web/playwright.config.ts`
  - `web/.gitignore`
- forbidden paths:
  - `web/src/store.ts`
  - `web/src/pages/**`
  - `web/src/data/db.ts`
  - `web/src/types.ts`
  - `docs/**`
  - `.workflow/**`
- exact strings:
  - Database name remains `CheckPointDB`.
  - Production manifest remains `dist/manifest.webmanifest`.
  - `npm run e2e` and `npm run e2e:ui` both use the owned Vite runner and do not restore Playwright's `webServer` block.
- acceptance:
  1. `updateSettings` performs spreadsheet-link conflict check, current-settings read, and final write in one Dexie read/write transaction so concurrent partial updates cannot lose fields.
  2. Browser evidence demonstrates concurrent partial settings updates retain both values.
  3. `npm run e2e` ensures the production manifest exists on a fresh checkout, then runs Playwright and exits cleanly.
  4. `npm run e2e:ui` starts the same owned Vite server; runner child spawn errors and SIGINT/SIGTERM paths close/terminate without an unresolved promise.
- verification:
  - `cd web && npm run lint`
  - `cd web && npm run build`
  - `cd web && npm run e2e -- e2e/data-migration.spec.ts e2e/pwa.spec.ts`
- slug: `gpt-5.6-terra` (user override resolved against live host list)

## Harvest

- W1 `writer-store-concurrency-and-revision-guards`: complete; changed only `web/src/store.ts` and `web/src/store.test.ts`. Added delete admission, same-object save cleanup, selection generations, and a StrictMode-safe init generation after integrated QA exposed premature `ready`. Focused store tests: 11/11; scoped lint passed.
- W2 `writer-history-session-request-generations`: complete; changed only the six owned History/Session files. Added class/request-keyed History rows/details and stale Session student-info rejection. Focused tests: 11/11; lint passed.
- W3 `writer-settings-transaction-and-e2e-lifecycle`: complete; changed `web/src/data/repository.ts`, `web/e2e/data-migration.spec.ts`, `web/e2e/run.mjs`, and `web/package.json`; preserved other owned paths. Added transactional settings updates, concurrent browser regression, fresh-checkout manifest build, owned UI runner, and child/signal cleanup. Focused browser tests: 3/3; lint/build passed.
- Follow-up `writer-generated-lint-ignore`: complete; changed only `web/eslint.config.js` so generated `dev-dist` is excluded from lint.
- Integrated QA first run: unit/lint/build green; E2E 3/5 because duplicate StrictMode `init()` published `ready` before the winning restoration. Tightened W1 corrected this root cause.
- Integrated QA final run: unit 10 files/86 tests passed; lint passed; build passed; Chromium E2E 5/5 passed and exited 0; a second lint after E2E-generated `dev-dist` passed; `git diff --check` passed.
- Verdict: `wave complete`; no boundary crossings and no second implementation wave required.
