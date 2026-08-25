Last Edited: 2026-08-25

# Plan: Simplification audit implementation

## 1. Current state

- Evidence-backed facts:
  - `.workflow/tasks/0001-simplification-audit/simplification-audit.md` inventories all 12 production boundaries and accepts eight findings (F1–F8); the audit found no omitted production subsystem.
  - `web/src/store.ts` is the runtime orchestration authority, but it separately stores `selectedClassId` and `selectedClass`, persists drafts under the selected id without checking the draft's class, and represents four concurrent operations as independent booleans.
  - `web/src/pages/History.tsx` separately stores `expandedId`, `expanded`, and `correcting`; a late detail request can render or correct a session under another row.
  - `web/src/pages/Session.tsx` uses a write-once `autoPicked` ref; the sidebar in `web/src/components/AppShell.tsx` can change class while the page remains mounted, leaving the page permanently on “Drawing students…”.
  - `web/src/services/sheetsClient.ts::spreadsheetExists` maps 403, 404, and every other non-OK response to `false`; `web/src/services/sheetsSync.ts::exportClassToSheet` then creates a replacement sheet and `web/src/store.ts::exportToSheets` persists its id.
  - `ClassEntity.defaultN` and `PerClassSettings.defaultN` are both persisted. `web/src/data/repository.ts` merges and mirrors them, and `web/src/services/sheetsSync.ts` exports both copies.
  - `web/src/domain/sessionDraft.ts::DraftSessionInputs` exposes three independently optional redraw fields although the only production redraw caller always binds them together.
  - `web/vite.config.ts` and `web/public/manifest.webmanifest` both claim ownership of the PWA manifest and disagree on colors and icon paths. The production build currently emits the VitePWA version; the static public file controls the dev URL.
- Owner files/symbols:
  - Runtime authority: `web/src/store.ts::useStore` and `StoreState`.
  - Durable data: `web/src/data/db.ts::CheckPointDB` and `web/src/data/repository.ts`.
  - Boundary-local UI state: `web/src/pages/History.tsx::History` and `web/src/pages/Session.tsx::Session`.
  - Sheets decision boundary: `web/src/services/sheetsClient.ts` probe plus `web/src/services/sheetsSync.ts::exportClassToSheet`.
  - Draft construction: `web/src/domain/sessionDraft.ts::buildDraftSession`.
  - PWA configuration: `web/vite.config.ts::VitePWA`.
- Current data/control flow:
  - Class selector/page -> `selectClass(id)` -> repository reads -> store writes id/entity/N/draft -> subscriber writes `currentSession` to `checkpoint_draft_session_<selectedClassId>`.
  - Export -> acquire Google token -> repository dataset -> boolean existence probe -> overwrite or create -> settings persist `spreadsheetId` and `lastExportedAt`.
  - History row -> independent expanded id -> asynchronous detail reads -> independent payload -> correction writes using the expanded id.
- Public behavior/API to preserve:
  - Local IndexedDB remains the source of truth; Sheets stays an explicit overwrite/import target, never a peer database.
  - Class selection and draft sessions persist across reloads and remain scoped per class.
  - Carryovers remain uncapped; redraw retains draft identity/carryovers and clears marks only after confirmation.
  - Previously exported Sheets tabs remain importable, including the `Classes.defaultN` compatibility column.
  - Core attendance remains usable offline; no backend or automatic sync is introduced.
- Limitations motivating the change: the accepted findings permit wrong-target writes, silent creation of replacement spreadsheets, duplicate persisted authority, invalid flag combinations, and inconsistent PWA metadata.
- Baseline evidence on 2026-08-25:
  - `npm run test:run`: 5 files / 52 tests passed.
  - `npm run lint`: passed.
  - `npm run build`: passed; generated PWA manifest uses the VitePWA values.
  - `npm run e2e`: the one Chromium test reported passed; the runner did not return control in the current PTY after reporting and was terminated. Implementation verification must require a clean command exit as well as passing tests.

## 2. Target shape

- Desired end state:
  - Runtime class scope is represented by one optional `selectedClass`; its id is derived at use sites.
  - Store-managed long-running operations use one exclusive, operation-keyed `inFlight: BusyKey | null` slot. Pages derive operation-specific labels from the key; store actions reject overlap and guard async commits against class/session drift.
  - History expansion is one request-keyed discriminated union, and Session auto-draw is keyed to the selected class with an explicit retryable failure state.
  - Sheet access distinguishes accessible, confirmed missing, and HTTP error. A replacement sheet is created only for no id or confirmed 404.
  - `PerClassSettings.defaultN` is the only local persistence authority. A Dexie migration preserves legacy class-row values; the Sheets `Classes.defaultN` column remains a derived compatibility projection.
  - Draft construction has exactly two modes: fresh draw or `redrawFrom` an existing draft.
  - VitePWA config is the only manifest owner.
- New/changed/deleted files:
  - Change: `web/src/types.ts`, `web/src/data/db.ts`, `web/src/data/repository.ts`, `web/src/domain/sessionDraft.ts`, `web/src/domain/sessionDraft.test.ts`, `web/src/store.ts`.
  - Change: `web/src/components/AppShell.tsx`, `web/src/pages/Home.tsx`, `Session.tsx`, `Roster.tsx`, `History.tsx`, `Settings.tsx`.
  - Change: `web/src/services/sheetsClient.ts`, `web/src/services/sheetsSync.ts`, `web/vite.config.ts`, `web/package.json`, `web/package-lock.json`.
  - Add focused tests: `web/src/services/sheetsClient.test.ts`, `web/src/services/sheetsSync.test.ts`, `web/src/data/repository.test.ts`, `web/src/store.test.ts`, `web/src/pages/History.test.tsx`, `web/src/pages/Session.test.tsx`, `web/e2e/pwa.spec.ts`, and `web/e2e/session-class-switch.spec.ts`.
  - Change documentation: `docs/product/prd.md`, `docs/product/design-overview.md`.
  - Delete: `web/public/manifest.webmanifest`.
  - Preserve untouched: root `package-lock.json` (pre-existing untracked user file), spreadsheet tab names/headers, IndexedDB database name, localStorage key names, and all unrelated scratch documents.
- Ownership boundaries:
  - Store owns class/session/sync orchestration and admission to long-running operations.
  - Pages own only their local presentation/request state.
  - Repository owns all IndexedDB migration and settings persistence.
  - Sheets client classifies HTTP access; Sheets sync chooses create versus overwrite.
  - Vite config owns generated PWA identity; `public/` owns only referenced image assets.
- New/changed APIs or data:
  - Remove `ClassEntity.defaultN` from the TypeScript domain shape.
  - Replace `StoreState.selectedClassId` with derived `selectedClass?.id`.
  - Replace `busy: Record<BusyKey, boolean>` with `inFlight: BusyKey | null`.
  - Add `classId` to `ImportPreview` so apply is bound to the class that was previewed.
  - Replace `DraftSessionInputs.{carryoverIdsOverride,baseSession,resetMarks}` and matching `PickOptions` fields with `redrawFrom?: SessionEntity`.
  - Replace `spreadsheetExists` with an explicit access probe result.
- Dependency direction:
  - Pages -> store/repository reads; store -> domain/repository/services; repository -> Dexie; services -> Google APIs. Tests mock at repository/service boundaries. No production dependency points back into pages or store.
- Compatibility path:
  - Dexie v3 migrates legacy `classes.defaultN` into `settings.defaultN` before class rows are rewritten without the duplicate field.
  - Spreadsheet headers and the `Classes.defaultN` cell remain unchanged; export derives both spreadsheet projections from effective settings and import continues to treat the Settings tab as authoritative.
  - Existing selected-class and draft localStorage keys are unchanged.

## 3. Contract

### Behavior

- Export overwrites an accessible linked sheet, creates only when no id exists or the API confirms 404, and preserves the linked id on 401/403/5xx or auth/network failure.
- History never renders or corrects details under a different session row; Session draws once per selected class and offers a retryable failure state instead of an infinite drawing placeholder.
- One canonical selected class scopes all drafts and async commits; store-managed pick/save/export/import operations cannot overlap, and stale completion cannot clear or persist another class/session.
- While a store-managed operation is active, `selectClass` returns without changing scope; disabling `#class-switcher` is the matching UX guard, while the store guard remains authoritative for programmatic callers.
- `defaultN` survives the IndexedDB upgrade and future writes occur only in `settings`; Sheets continue to round-trip the existing tab schema.
- Fresh/redraw draft semantics and PWA install metadata remain observable as before, with impossible redraw flag combinations and the duplicate static manifest removed.

### Domain language

- Canonical terms/contexts: selected class, draft session, carryover/recheck, absence ledger, effective settings, linked spreadsheet, explicit export/import, operation-keyed status.
- Inferred meanings or conflicts:
  - `docs/product/design-overview.md` says “operation-scoped UI status.” The target `inFlight` slot preserves the operation key for scoped labels/errors while making admission exclusive; this is a refinement of that invariant, not a return to an untyped global loading boolean.
  - Spreadsheet “sync” in file/function names means explicit export/import per `docs/implementation/revamp-2026-07.md`; no merge/reconciliation semantics are added.
  - The Classes-tab `defaultN` column is a compatibility projection, not a second authority.

### Non-goals

- Change sampling, carryover, ledger, roster identity, import validation, or correction semantics.
- Introduce a general state-machine framework, cancellation library, shared page-data loader, backend, analytics, or automatic Sheets synchronization.
- Serialize every repository/page action globally; the exclusive slot covers the existing store-managed `pick`, `save`, `export`, and `import` operations. Boundary commits must still be class/session guarded.
- Remove or rename spreadsheet tabs/columns, localStorage keys, public store action names, or IndexedDB entity ids.
- Clean unrelated code, update old scratch plans, or modify the pre-existing root `package-lock.json`.

### Acceptance checks

| check | proof method | required evidence |
|---|---|---|
| AC1 Sheets target safety | Unit tests with mocked OAuth/fetch and mocked Sheets client, plus the Phase 6 store boundary test | 200 overwrites; absent id/404 creates; 401/403/5xx return errors; no create call or replacement id is persisted on errors |
| AC2 Request-keyed UI state | Controlled-promise component tests plus targeted Playwright flow | A->B expansion cannot be overwritten by late A; correction uses B; class switch on `/session` draws/restores for the new class; failed draw exposes retry |
| AC3 Store scope and exclusivity | Store tests with mocked repository/services and deferred operations | missing class clears selection; draft autosave requires matching class; overlap is rejected; stale pick/save/import commits cannot alter a newer scope |
| AC4 Single `defaultN` authority | fake-indexeddb migration/repository tests and Sheets export tests | legacy value survives v2->v3; class rows no longer own the field; settings writes are single-owner; both spreadsheet projections match settings |
| AC5 Simplification regression | Domain tests, PWA manifest test, build/lint/full E2E | redraw has only fresh/redraw modes and preserves invariants; one manifest has correct colors/icons/display/start URL; all commands exit cleanly |

### Unverified change control

- Intended batch size: one finding per commit-sized vertical slice; no slice may carry unverified changes into the next.
- Checkpoint cadence: run the slice’s focused tests plus `npm run lint` and `npm run build`; run the full unit/E2E suite after slices 4, 7, and 8.
- Rollback/resume point: the last slice with its focused tests and build green; each phase below is independently revertible except documented dependency ordering.
- Refactor/cleanup separation: only mechanical call-site changes required by a representation change travel with that slice. Opportunistic page/store cleanup is deferred.

### Risk profile

- Correctness: high for Sheets target selection, history correction, draft scope, async completion, and Dexie migration.
- Performance: low; changes add constant-time state guards and a one-time per-class migration.
- Boundary/external integration: high at Google HTTP classification and PWA generation; both require boundary-level tests.
- User/data impact: medium-high because a wrong decision can create an unintended sheet, write/correct the wrong class/session, or lose a legacy setting. All such paths fail closed.

## 4. Data / API shape

- Fields/public members and required/optional rules:
  - `ClassEntity = { id: string; name: string }`.
  - `PerClassSettings.defaultN` remains required in persisted/runtime effective settings.
  - `SpreadsheetAccessProbe = { status: 'accessible' } | { status: 'missing' } | { status: 'error'; httpStatus: number; message: string }`.
  - `ExpansionState = { status: 'collapsed' } | { status: 'loading'; sessionId: string; requestId: number } | { status: 'open'; sessionId: string; requestId: number; details: ExpandedDetails; correctingStudentId?: string }` local to History.
  - `StoreState.inFlight: 'pick' | 'save' | 'export' | 'import' | null`.
  - `ImportPreview` gains required `classId`; `applyImport` rejects when it differs from the current selected class.
  - `DraftSessionInputs.redrawFrom?: SessionEntity`; redraw always preserves id/date/createdAt/savedAt/carryovers and emits empty marks.
- Stable identifiers: class, student, session, ledger, spreadsheet, selected-class key, and per-class draft keys do not change.
- Versioning/compatibility:
  - IndexedDB schema version increments from 2 to 3 solely for data migration; indexes/table names stay the same.
  - Sheet schema is not version-bumped because headers remain unchanged.
  - Store action result types remain as currently exposed except the internal representation and `ImportPreview.classId` addition.
- Source-to-runtime mapping:
  - `settings.defaultN` -> `currentN` working cache refreshed by `selectClass`, `updateSettings`, and `applyImport` -> session builder `n` -> Settings and Classes sheet cells.
  - `selectedClass.id` -> repository query class id and draft key; a `currentSession` is persisted only when `currentSession.classId === selectedClass.id`.

## 5. Runtime / loader / UX behavior

- Entry points:
  - App init and sidebar/Home class selection call `selectClass`.
  - Session mount/retry calls `pickStudents`; controls call redraw/save.
  - Settings calls export, preview, confirm, and apply.
  - History row/correction controls operate on the local expansion union.
- Cache/reload/invalidation:
  - Selection restore reads the stored id, resolves the class, then commits/persists only a found entity.
  - `currentN` is a working cache sourced from `settings.defaultN`, not a live derived read; `selectClass`, `updateSettings`, and `applyImport` are its complete invalidation/refresh points.
  - Class changes invalidate History request generations and Session auto-draw failure/latch state.
  - Draft autosave ignores mismatched session/class pairs; save removes the draft by `session.classId` and clears working state only if the same session is still current.
- Validation:
  - Probe status is based on HTTP status: 2xx accessible, 404 missing, all other non-OK error. Token/network exceptions remain errors.
  - Every operation checks `inFlight === null` before acquisition and clears only its own slot in `finally`.
  - Pick rechecks selected class before committing; import apply checks preview class; correction reads its session id from an open expansion state.
- Diagnostics/errors:
  - Sheets errors retain HTTP status/body summary in the returned store error; credentials or access failures never appear as “missing.”
  - Session empty state distinguishes drawing from failed/blocked and exposes Retry; existing toast patterns handle redraw/save errors.
  - Store overlap returns existing typed `blocked`/failed results with an actionable “another operation is in progress” message.
- Fallback:
  - Missing selection or missing repository class clears scope to none.
  - 404/no linked id creates a sheet; all ambiguous failures preserve the old id and stop.
  - A stale UI request is ignored; the currently keyed request remains authoritative.
- Cleanup/lifecycle:
  - History increments/invalidate request generation on collapse, class change, clear, and delete of the open row.
  - Session ignores late auto-draw results after class change/unmount.
  - Operation slots release in `finally` on success, typed failure, and thrown exception. `selectClass` does not change scope while a slot is held.

## 6. Dependencies and constraints

- New dependencies/references:
  - Dev-only: `@testing-library/react` and `jsdom` for deterministic page-state tests; `fake-indexeddb` for repository/migration tests.
  - No new production dependency.
  - `web/vite.config.ts` test include expands from `.test.ts` to both `.test.ts` and `.test.tsx`; component tests opt into jsdom locally.
- Design constraints:
  - Preserve the revamp layering: pages -> store/domain/repository/services; repository is the only IndexedDB owner.
  - Preserve fail-closed external I/O and no alerts/confirms below pages.
  - Tests must not weaken existing assertions or use real Google network access.
- Rejected alternatives and rationale:
  - Pairwise busy checks: grows combinatorially and leaves invalid combinations representable.
  - A second selected-class id cache: preserves the invalid dual-owner state.
  - Full Session/History framework state machines: more machinery than the two local unions/latches require.
  - Silently treating 403 as missing: can replace a real linked sheet.
  - Leaving `defaultN` fallback on class rows indefinitely: retains the duplicate authority the finding removes.
- Version/platform assumptions: current React 19, Zustand 5, Dexie 4, Vite 7, Vitest 4, Playwright 1.61, and VitePWA 1 are retained.
- Permission/environment limits: automated Sheets tests use mocks only; a live Google account is not required. Production manifest verification reads the built output; Playwright covers the local dev manifest and icon requests.

## 7. Authority and state ownership

- Authority owner: `web/src/store.ts::useStore` is the single runtime authority for selected class, draft session, effective N, and admission/commit of store-managed long-running operations.
- Decision point: each store action acquires `inFlight`, captures the selected class/session identity, and revalidates that identity before committing working or persisted state.
- Source of truth:
  - IndexedDB entity tables; `settings.defaultN` is the only local default-N authority and ledger remains absence authority.
  - `web/vite.config.ts::VitePWA.manifest` is the PWA identity authority.
  - Google Sheets is an explicit external import/export target, never the app authority.
- Working state: store `selectedClass`, `currentSession`, and `inFlight`; `currentN` is a settings-sourced working cache refreshed only by `selectClass`, `updateSettings`, and `applyImport`; page-local History expansion and Session auto-draw failure/latch.
- Derived/cache state: `selectedClass.id`, page rows/stats/student info, absence counts/carryovers, sheet Classes-tab defaultN, and generated `dist/manifest.webmanifest`.
- Persisted state: IndexedDB; `checkpoint_selected_class`; `checkpoint_draft_session_<classId>`; spreadsheet linkage/export timestamp within per-class settings.
- Boundary readers/writers:
  - Repository alone reads/writes IndexedDB and performs v3 migration.
  - Store alone coordinates selected class, drafts, and Sheets actions; its subscriber writes draft localStorage.
  - Sheets client reads HTTP response status; Sheets sync writes the external sheet; store persists linkage only on successful summary.
  - Pages read store/repository and write only page-local UI state.
- Dependency direction and cycle prevention: domain and types stay leafward; repository/services never import store/pages; page test helpers remain test-only; no common helper imports a page-local union.

## 8. Proposed approach

### Phase 1: F2 — fail-closed linked-sheet probe

- Execution mode: AFK
- Change and rationale: replace the lossy boolean with the explicit access result and switch export on that result, so only confirmed absence creates a replacement.
- Files/symbols: `sheetsClient.ts::{SpreadsheetAccessProbe,probeSpreadsheetAccess}`, `sheetsSync.ts::exportClassToSheet`; add both service test files.
- Authority rationale: HTTP meaning is decided at the client boundary; create/overwrite policy remains in Sheets sync.
- Acceptance impact: AC1 service/sync policy only; full AC1 closure waits for the Phase 6 store persist-negative test.
- Independent proof/checkpoint: focused client/sync tests, lint, and build prove HTTP classification plus create/overwrite/error policy. This phase does not close the store-side persistence clause of AC1; Phase 6 `store.test.ts` closes it by proving `spreadsheetId` is unchanged when export throws.
- Tests included: canonical accessible status 200; supplementary 204; 404, 401, 403, 500, fetch/token rejection; no-id/missing/access/error export branches. OAuth mocks distinguish the probe's default `SHEETS_SCOPES` token request from export's pre-authorization with Drive scopes.
- Unverified-change limit: two production service files plus their tests.
- Ordered steps:
  1. Define the probe union using bounded raw `fetch`, not `fetchJson`, so non-OK status/body evidence remains classifiable without being collapsed into a thrown error; do not call real Google APIs in tests.
  2. Rename the single call site and switch create/ensure/error behavior explicitly.
  3. Verify errors throw through `exportClassToSheet` and no create is called; defer the store persist-negative assertion to the named Phase 6 store test.

### Phase 2: F1 — request-keyed History expansion

- Execution mode: AFK
- Change and rationale: collapse three correlated state values into `ExpansionState` and commit loaded/corrected data only for the matching request generation.
- Files/symbols: `pages/History.tsx::{ExpansionState,loadDetails,handleExpand,handleCorrect}`; test config/dev dependencies; add `pages/History.test.tsx`.
- Authority rationale: expansion is presentation state and remains local to History; repository correction API is unchanged.
- Acceptance impact: AC2.
- Independent proof/checkpoint: controlled deferred promises demonstrate late A cannot overwrite B and correction targets the open session.
- Tests included: expand/collapse, A->B late response, A->B->A generation, correction refresh, class-change invalidation, deletion/clear collapse.
- Unverified-change limit: History plus the minimum component-test harness.
- Ordered steps:
  1. Add `.test.tsx` discovery and jsdom/testing-library dev dependencies; each component test declares `// @vitest-environment jsdom` instead of changing the global environment.
  2. Introduce the discriminated union and request counter; remove `expandedId`, `expanded`, and `correcting`.
  3. Route load/correction/delete/clear/render decisions through the keyed state and ignore stale promises.
  4. Prove user-visible row/body/correction identity with controlled repository mocks.

### Phase 3: F6 — one PWA manifest owner

- Execution mode: AFK
- Change and rationale: make required install fields explicit in VitePWA config and delete the conflicting public manifest.
- Files/symbols: `vite.config.ts::VitePWA.manifest`, delete `public/manifest.webmanifest`, add `e2e/pwa.spec.ts`.
- Authority rationale: VitePWA already generates the service worker and production manifest.
- Acceptance impact: AC5.
- Independent proof/checkpoint: after `npm run build`, `e2e/pwa.spec.ts` reads and asserts the production `dist/manifest.webmanifest`; the same spec requests the dev manifest and proves every referenced icon returns HTTP 200.
- Tests included: manifest name/colors/display/start URL/icon paths and icon HTTP 200.
- Unverified-change limit: config, one deleted file, one test.
- Ordered steps:
  1. Add explicit `display: 'standalone'` and `start_url: '/'` to the plugin manifest. The plugin already emits these defaults in `dist`; spelling them out preserves one explicit owner and dev/build parity after the static file is removed.
  2. Delete the static manifest; retain `logo-192.png`, `logo-512.png`, favicon, and theme meta.
  3. Run `npm run build` before the focused Playwright spec; assert production fields from the built JSON and exercise the dev manifest/icon HTTP paths. A second preview server/project is not required.

### Phase 4: F7 — two-mode draft builder

- Execution mode: AFK
- Change and rationale: replace eight possible optional combinations with fresh draw versus `redrawFrom`.
- Files/symbols: `domain/sessionDraft.ts::DraftSessionInputs/buildDraftSession`, `domain/sessionDraft.test.ts`, `store.ts::{PickOptions,pickStudents,redrawRandom}`.
- Authority rationale: the pure builder owns draft representation; the store only chooses the mode.
- Acceptance impact: AC5.
- Independent proof/checkpoint: domain tests prove identity/carryovers preserved, ghost ids dropped, marks cleared, and subset invariants in both modes.
- Tests included: update existing redraw/ghost tests; add non-empty marks and `createdAt`/`savedAt` preservation assertions.
- Unverified-change limit: builder, its tests, and mechanical store call-site fields.
- Ordered steps:
  1. Replace the three fields with `redrawFrom` and branch once inside the builder.
  2. Update `PickOptions` and `redrawRandom` to pass the current draft as `redrawFrom`.
  3. Remove test-only override mode and prove `carryoverIds ⊆ picks` and `marks ⊆ picks`.
  4. Run the full unit/lint/build/E2E checkpoint.

### Phase 5: F8 — settings-only `defaultN`

- Execution mode: AFK
- Change and rationale: remove duplicate domain/persistence ownership and migrate existing values without changing the spreadsheet contract.
- Files/symbols: `types.ts::ClassEntity`, `data/db.ts::CheckPointDB`, `data/repository.ts::{createClass,getEffectiveSettings,updateSettings,replaceClassData}`, `services/sheetsSync.ts::exportClassToSheet`; add repository tests and extend Sheets sync tests; update PRD/design overview.
- Authority rationale: repository/Dexie own migration and persistence; effective settings own the value; Sheets values are projections.
- Acceptance impact: AC4.
- Independent proof/checkpoint: fake IndexedDB seeded at v2 upgrades to v3 with exact custom values and no class-row duplicate; exported Settings and Classes cells match.
- Tests included: migration with/without existing settings, new class atomic class+settings creation, single-table update, import replacement, export fallback/compatibility.
- Unverified-change limit: type/data/sheet projection plus their tests/docs; no store selection refactor yet.
- Ordered steps:
  1. Add an optional DB-name constructor seam for tests and a v3 upgrade that copies each legacy class `defaultN` only when settings lack it, preserves all other settings, and rewrites class rows to `{id,name}`.
  2. Make `createClass` atomically create class and default settings; remove class fallback/mirror logic from repository methods.
  3. Remove the field from `ClassEntity`; derive both exported spreadsheet cells from settings (`DEFAULT_N` only as corruption-safe fallback).
  4. Update canonical product data-model/authority documentation while explicitly preserving the Classes-tab column.

### Phase 6: F4 — one selected class entity

- Execution mode: AFK
- Change and rationale: remove the dual nullable id/entity pair, fail closed on missing selection, and key every draft operation from the resolved entity.
- Files/symbols: `store.ts::{StoreState,init,selectClass,deleteClass,pickStudents,discardDraft,saveSession,updateSettings,exportToSheets,previewImport,applyImport,subscribe}`; all `selectedClassId` readers in AppShell/Home/Session/Roster/History/Settings; add/extend `store.test.ts`.
- Authority rationale: only the store resolves and commits selected scope; pages derive a local `classId = selectedClass?.id`.
- Acceptance impact: closes AC1 and advances AC2/AC3.
- Independent proof/checkpoint: mocked repository tests cover found/missing selection, reload restore, class-matched draft persistence, and stale pick completion.
- Tests included: missing id clears localStorage/scope; valid id restores only its draft; mismatched currentSession is not autosaved; pick completion after selection change is ignored; an export throw leaves the existing `spreadsheetId` unchanged and closes AC1's store persistence clause.
- Unverified-change limit: store representation plus mechanical readers and the AC1 persist-negative regression test; no mutex change in this slice. Subscriber and pick identity guards land here, but cross-operation exclusivity remains intentionally deferred to Phase 7.
- Ordered steps:
  1. Remove `selectedClassId`; centralize clear-selection and resolved-selection commits inside `selectClass`.
  2. Replace each reader with `selectedClass?.id` while preserving page empty/redirect behavior.
  3. Key draft removal/autosave from session/resolved class and require matching ids.
  4. Recheck class identity before async pick commits and remove the now-unreachable orphan-session delete branch.
  5. Add the store boundary regression proving a failed export never calls settings persistence and retains the linked spreadsheet id.

### Phase 7: F5 — exclusive operation-keyed slot

- Execution mode: AFK
- Change and rationale: replace independent flags/pairwise UI checks with one admission slot, while guarding each async commit by captured identity.
- Files/symbols: `store.ts::{BusyKey,StoreState,setBusy,pickStudents,redrawRandom,saveSession,exportToSheets,previewImport,applyImport,ImportPreview}`, `components/AppShell.tsx`, `pages/Session.tsx`, `pages/Settings.tsx`; extend store/component tests and design overview.
- Authority rationale: the store is the only place that can observe cross-page operations; the operation key remains available for scoped UI labels.
- Acceptance impact: AC3.
- Independent proof/checkpoint: deferred-operation tests attempt every conflicting second action and prove rejection/release on success and throw.
- Tests included: pick/save/import overlap, duplicate preview/apply, slot finally cleanup, stale save session, class-bound preview, store-level class-switch no-op, and matching UI disable/label derivation.
- Unverified-change limit: store operation model and its direct UI readers.
- Ordered steps:
  1. Introduce `inFlight` and an acquire/release helper that never clears a slot it does not own.
  2. Guard all four operation families before side effects; preserve existing `PickStatus`/`ActionResult` surface semantics.
  3. Bind preview to `classId`; reject apply after selection drift; clear a saved draft/current session only when captured ids still match.
  4. Make `selectClass` return without mutation when `inFlight !== null`; replace page boolean reads with operation-key comparisons and disable `#class-switcher` plus store-operation entry points as the matching UX guard.
  5. Update design wording to “exclusive operation-keyed status,” then run the full unit/lint/build/E2E checkpoint.

### Phase 8: F3 — class-keyed Session auto-draw and recovery

- Execution mode: AFK
- Prerequisites: Phases 6 (F4) and 7 (F5) must be complete because this slice relies on canonical `selectedClass`, stale-commit guards, and typed blocked results. AC2's Session portion is intentionally deferred until these prerequisites are green.
- Change and rationale: key the one-shot latch to class identity, await the action result, and render a retryable failure instead of conflating empty/drawing/failed.
- Files/symbols: `pages/Session.tsx` auto-draw effect/empty UI; add `pages/Session.test.tsx` and `e2e/session-class-switch.spec.ts` for in-page class switching.
- Authority rationale: store still builds/owns the draft; Session owns only mount-specific auto-start and failure presentation.
- Acceptance impact: AC2, AC5 regression.
- Independent proof/checkpoint: mocked component tests cover restored draft and forced failure cases. Browser setup creates Class A and Class B with distinct rosters, starts `/session` on A, changes `#class-switcher` to B without leaving the route, asserts B student cards are visible and A cards are absent, asserts the UI does not remain on “Drawing students…”, reloads, and proves B retains its draft.
- Tests included: first visit once, restored draft no second pick, A->B new draw, late A result ignored, blocked/error retry, save/discard navigation no redraw.
- Unverified-change limit: Session, its component test, and the single named class-switch E2E spec.
- Ordered steps:
  1. Replace the boolean ref with the last-attempted class id and local failure state; reset them on class change.
  2. Await `pickStudents`, ignore results for a no-longer-selected class, and map `blocked`/`error` to actionable copy with Retry.
  3. Preserve restored-draft and post-save/discard semantics.
  4. Implement the named two-class Playwright scenario, then run all focused and full verification commands and capture final evidence.

### Complexity intentionally avoided

- No shared optional-pair helper, generalized request/cache framework, or state-machine package.
- No pairwise operation compatibility matrix; the single slot is the policy.
- No permanent legacy `ClassEntity.defaultN` shim or second manifest generation path.

## 9. Migration

- Behavior/data to preserve:
  - Existing custom default N, class/roster/session/ledger/settings/linkage data, selected class, and draft localStorage.
  - Existing exported spreadsheets and import parsing.
- Stable ids/names/methods/paths:
  - Database `CheckPointDB`, table/index names, all entity ids, spreadsheet tab/header names, localStorage keys, routes, and user-facing action names.
- Mechanical movement:
  - Dexie v3 upgrade reads legacy class rows, creates/merges settings using `settings.defaultN ?? legacyClass.defaultN ?? DEFAULT_N`, preserves weights/linkage/timestamps, then stores class rows without `defaultN`.
  - New class creation writes class and settings atomically; no lazy dual-source fallback remains after upgrade.
- Test/assertion churn:
  - Update fixtures constructing `ClassEntity`; spreadsheet assertions continue expecting the Classes column but source expected value from settings.
  - Update all `selectedClassId` and `busy.*` tests/readers mechanically; do not broaden behavior assertions.
- Rollback/compatibility:
  - A code rollback after DB v3 is safe only after AC4 migration tests prove every seeded legacy custom `defaultN` is backfilled into settings before the class-row duplicate is removed. Under that verified precondition, old code sees `defaultN` absent but `getEffectiveSettings` and the old Classes export fallback both prefer the populated settings row.
  - If the Phase 5 fake-indexeddb migration evidence does not show preserved values for legacy rows with no settings and settings-wins behavior for disagreements, stop before phases 6–8; do not ship a partial data-ownership move or claim rollback safety.

## 10. Impacted surfaces

- Browser/client: History expansion/correction, Session auto-draw/retry, class selector, busy labels/disabled controls.
- Data pipeline: Dexie v3 migration and repository effective-settings behavior.
- Build/deploy: VitePWA generated manifest and removal of the static public manifest.
- Test harness: Vitest TSX/jsdom component tests, fake IndexedDB tests, Playwright PWA and attendance flows.
- Docs/config/assets/schemas: product data model and operation-status wording; Vite config; package/lock files. Existing icon assets and Sheets schema remain.

## 11. Edge cases and failure modes

| case | hazard type | intended failure mode | user-visible effect | proof |
|---|---|---|---|---|
| linked sheet returns 401/403/5xx or fetch rejects | external boundary | hard-fail; retain old link; create nothing | export error toast | mocked client/sync/store tests |
| linked sheet returns 404 or no id exists | external boundary | create once, then persist returned id | successful export summary | sync tests |
| History A resolves after B, or A->B->A | async reentrancy | ignore nonmatching request generation | only current row/details shown | deferred component tests |
| correction/delete/clear during open detail | authority/lifecycle | act on keyed open session; collapse/invalidate as required | no wrong-session mutation | component tests |
| selected class changes during pick/save/import | async authority | reject stale commit; bind persisted cleanup/data to captured class/session | new class/draft remains intact | store tests/E2E |
| second long operation starts | concurrency | return blocked/failed before side effects | relevant control disabled or toast | store/component tests |
| preview confirmed after class switch | destructive boundary | reject apply due to class mismatch | import error; no local overwrite | store test |
| v2 class has custom N and no settings | migration | migrate custom N and default other settings | same N after upgrade | fake-indexeddb migration test |
| v2 class/settings N disagree | migration | existing settings wins; class duplicate removed | configured settings retained | migration test |
| redraw source contains marks/ghost carryovers | domain invariant | clear marks; filter ghosts; preserve draft identity | coherent redraw | domain tests |
| component unmount/class change with request pending | lifecycle | ignore late result | no warning or stale UI | component tests |
| static manifest removed | build/runtime | plugin supplies sole dev/build manifest | install metadata stays dark/valid | PWA E2E/build inspection |

## 12. Verification plan

### Acceptance trace

| acceptance check | planned proof | evidence to collect | status |
|---|---|---|---|
| AC1 Sheets target safety | Phase 1 service tests + Phase 6 store persist-negative test | named passing status cases, create/update mock call counts, and unchanged settings/link id on throw | planned |
| AC2 Request-keyed UI state | History/Session component tests + `e2e/session-class-switch.spec.ts` | controlled-resolution assertions plus two-class mounted-route/reload Playwright result | planned |
| AC3 Store scope/exclusivity | store deferred-promise tests | blocked results, zero side-effect calls, matching final state | planned |
| AC4 Single defaultN authority | migration/repository/export tests | upgraded rows/settings and emitted sheet cells | planned |
| AC5 Full simplification regression | domain/PWA tests and full commands | test counts, clean exits, built manifest excerpt | planned |

### Automated checks

- Focused during slices: `npm run test:run -- <test-file...>` from `web/`.
- Full unit: `npm run test:run`; expected all existing and new tests pass with no unexpected console errors.
- Static/build: `npm run lint` and `npm run build`; expected exit 0 and one generated `dist/manifest.webmanifest`. The PWA spec reads that built JSON for production-field assertions; its browser requests cover the dev manifest and icons.
- Browser: `npm run e2e`; expected all Chromium tests pass and the process exits with code 0. Record the exit code and test count in `progress.md`; a printed pass followed by a hung process fails AC5. If the hang recurs, fix the runner/shutdown path and rerun before claiming AC5.
- Repository cleanliness: `git status --short` and `git diff --check`; expected only planned task/production/test/doc files plus the user's pre-existing untracked root `package-lock.json`.

### Manual checks

- Optional Google smoke (HITL only if credentials are available): export to an accessible linked sheet and verify overwrite/link remains. Do not deliberately revoke access or delete a real sheet; mocked tests are authoritative for errors/404.
- Browser session/class smoke: create two classes with rosters, switch from A to B while on `/session`, retry a forced/observed failure if available, reload, and verify each class retains only its own draft.
- History smoke: save two sessions, expand/correct each, switch rows quickly, collapse/delete one, and verify summaries/body/ledger remain aligned.
- PWA smoke: after build, serve preview, inspect install manifest and icon requests.

### Not verified by this plan

- Real Google 401/403/5xx responses are not induced against user data; deterministic boundary mocks cover the policy.
- Cross-browser PWA installation is not required; Chromium plus generated manifest/assets is proportionate to this config-only change.
- A pre-v3 application binary is not run against an upgraded database. Rollback compatibility remains conditional on exhaustive AC4 migration evidence that every legacy custom N is present in settings before class-row cleanup.

## 13. Documentation notes

- Docs to update:
  - `docs/product/prd.md`: remove `defaultN` from `ClassEntity`, retain it on `PerClassSettings`, state the Classes sheet value is a compatibility projection, and correct `web/src/db.ts` to `web/src/data/db.ts`.
  - `docs/product/design-overview.md`: update the data diagram/key entities and describe exclusive operation-keyed status without implying concurrent store operations are allowed; correct `web/src/db.ts` to `web/src/data/db.ts`; replace stale `opStatus`, `google.ts`, `sync.ts`, `probeCheckpoint*`, and `checkpoint_last_sync_report_*` references with the actual `busy`/target `inFlight`, `services/sheetsClient.ts`, `services/sheetsSync.ts`, and existing persisted keys; align the testing table with `attendance`, `validation`, `sheetImport`, `sessionDraft`, and `sampling` modules.
- Durable authority note: `docs/implementation/revamp-2026-07.md` remains the sync-model authority; no change is needed because the Sheets schema and explicit import/export model stay intact.
- Supporting task context kept: `simplification-audit.md` remains a non-authoritative evidence inventory with detailed F1–F8 code anchors. This `plan.md` owns implementation order, acceptance, and any sequencing refinements.
- Explicitly dropped review nit: the PRD's unrelated legacy `csvPath?` mention is outside F1–F8 and does not affect this plan's contract; do not expand the implementation diff solely to clean it up.
- Maintenance expectation: future class settings belong only in `PerClassSettings`; new long-running store actions must join the single `inFlight` admission boundary or explicitly document why they are read-only/out of scope.

## 14. Open questions / missing info

- None. The audit plus current code/docs resolve behavior, ownership, compatibility, and acceptance sufficiently for implementation. A live Google credential is optional smoke evidence, not a blocker.
