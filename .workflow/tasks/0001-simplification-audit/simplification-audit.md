# Simplification Audit

Last Edited: 2026-08-25
Repository: D:/Projects/class/CheckPoint
Execution: parallel workers
Status: supporting evidence only; `plan.md` is the canonical implementation contract. Where this audit presents alternative fixes or original priority order, the plan's selected design, phase order, acceptance checks, and verification gates take precedence.

## Coverage contract

Client-only React PWA. No server package. IndexedDB is the local store; Google Sheets is an explicit export/import bridge. VitePWA generates the service worker from `web/vite.config.ts` (S12 owns that contract). Colocated `*.test.ts` files belong to the domain row they test, not S12.

| id | name | boundary | impl | interfaces | status |
|---|---|---|---|---|---|
| S1 | Shared domain types | `web/src/types.ts` | `web/src/types.ts` | Consumed by store, repository, domain, pages, sheets, csv. No dedicated tests. | recommend |
| S2 | Weighted sampling | `web/src/domain/sampling.ts`, `web/src/domain/sampling.test.ts` | `web/src/domain/sampling.ts` | `weightedSampleWithoutReplacement`; called from `sessionDraft.ts`. Tests: `sampling.test.ts`. | skip |
| S3 | Attendance / carryover domain | `web/src/domain/attendance.ts`, `web/src/domain/attendance.test.ts` | `web/src/domain/attendance.ts` | `computeCarryovers`, `computeEligibleWithWeights`, `countAbsencesByStudent`; called from `sessionDraft.ts`, `repository.ts`. Tests: `attendance.test.ts`. | skip |
| S4 | Session draft builder | `web/src/domain/sessionDraft.ts`, `web/src/domain/sessionDraft.test.ts` | `web/src/domain/sessionDraft.ts` | `buildDraftSession`, `DEFAULT_N` and weight constants; called from `store.ts`. Tests: `sessionDraft.test.ts`. | recommend |
| S5 | Sheet import parse/validate | `web/src/domain/sheetImport.ts`, `web/src/domain/validation.ts`, `web/src/domain/sheetImport.test.ts`, `web/src/domain/validation.test.ts` | `sheetImport.ts`, `validation.ts` | `parseSheetExport`, row validators; called from `store.ts` `previewImport`. Tests: `sheetImport.test.ts`, `validation.test.ts`. | skip |
| S6 | Persistence (Dexie + repository) | `web/src/data/` | `db.ts`, `repository.ts` | `CheckPointDB`; `getClassDataset`, `saveSessionWithLedger`, `correctMark`, `replaceClassData`, `deleteClassCascade`. Call sites: `store.ts`, pages. No dedicated tests. | skip |
| S7 | App store / session orchestration | `web/src/store.ts` | `web/src/store.ts` | `useStore`; `pickStudents`, `redrawRandom`, `saveSession`, Sheets export/import. Call sites: `App.tsx`, all pages. No dedicated tests. | recommend |
| S8 | Google Sheets platform bridge | `web/src/services/` | `sheetsClient.ts`, `sheetsSync.ts` | `getAccessToken`, `exportClassToSheet`, `fetchClassTabs`, `TAB_HEADERS`. Call sites: `store.ts`. No dedicated tests. | recommend |
| S9 | CSV roster I/O | `web/src/utils/csv.ts` | `web/src/utils/csv.ts` | `parseRosterCsv`, `toStudentEntities`, `exportAbsencesCsv`. Call sites: `Roster.tsx`, `History.tsx`. No dedicated tests. | skip |
| S10 | App shell, routing, chrome | `web/src/App.tsx`, `web/src/main.tsx`, `web/src/ErrorBoundary.tsx`, `web/src/index.css`, `web/src/components/` | `App.tsx`, `AppShell.tsx`, `Dialog.tsx`, `Toast.tsx`, `ErrorBoundary.tsx` | Routes; `useConfirm`, `useToast`. Call sites: pages. No dedicated tests. | skip |
| S11 | Feature pages | `web/src/pages/` | `Home.tsx`, `Session.tsx`, `Roster.tsx`, `History.tsx`, `Settings.tsx` | Page components; call store, repository, csv, dialogs. Covered indirectly by `web/e2e/attendance.spec.ts`. | recommend |
| S12 | Build, PWA, and test tooling | `web/vite.config.ts`, `web/playwright.config.ts`, `web/eslint.config.js`, `web/tsconfig.json`, `web/tsconfig.app.json`, `web/tsconfig.node.json`, `web/index.html`, `web/public/`, `web/e2e/`, `web/package.json` | `vite.config.ts` (VitePWA generated SW), `playwright.config.ts`, `e2e/attendance.spec.ts` | npm scripts `dev`/`build`/`test:run`/`e2e`; PWA manifest. | recommend |

Out of inventory (not identifiable production subsystems): `docs/`, `rosters/` sample CSVs, `.cursor/commands/`, root `LICENSE.md`/`README.md`, `web/src/vite-env.d.ts` (Vite ambient `reference` only), pre-existing untracked root `package-lock.json`.

## Confirmed opportunities

### F1 — History expansion as one id-keyed union

- Subsystem: S11 Feature pages
- Verdict: recommend
- Evidence:
  - `web/src/pages/History.tsx:27-29` — `expandedId`, `expanded`, and `correcting` are independent pieces of the same expand/correct interaction.
  - `web/src/pages/History.tsx:75-83` — switching rows sets `expandedId` immediately and does not clear `expanded`; previous details remain until the new fetch resolves.
  - `web/src/pages/History.tsx:64-72` — `loadDetails` always `setExpanded` with no request id, so a slower prior fetch can overwrite a newer one.
  - `web/src/pages/History.tsx:85-90` — `handleCorrect` writes against `expandedId` while cards render `expanded.session`.
  - `web/src/pages/History.tsx:191-197` — row body renders when `expandedId === r.id && expanded` with no check that `expanded.session.id === r.id`.
- Current complexity or invalid states:
  Representable and rendered: collapsed; loading first open (id set, expanded null); switch/race (`expandedId` is B, `expanded` is still A's details under B's row); `correctMark(classId, B, studentFromA)`. `correcting` is a third uncorrelated boolean.
- Proposed representation and why it is simpler:
  One discriminated union keyed by session id, e.g. `{ status: 'collapsed' } | { status: 'loading'; id } | { status: 'open'; id; details: ExpandedDetails }`. Derive correcting from an in-flight id on that same value. Id, payload, and loading become one value, so the wrong-session body and wrong-session correction cannot be represented.
- Smallest credible implementation scope:
  - Files: `web/src/pages/History.tsx`
  - Interfaces: local expand state; `handleExpand` / `loadDetails` / `handleCorrect` / expand-row render. Do not extract a shared widget or change `repository.correctMark`.
- Regression risks and migration:
  Collapse/expand toggle, class change still clearing expand (`useEffect` on `load`), delete of the open row, and `correctMark` reload of both the summary list and the open body.
- Validation:
  - Existing: `web/e2e/attendance.spec.ts` lists history rows after golden-path saves; it never expands a row, corrects a mark, or switches the open row.
  - Additional: expand A then B and assert B's picks; expand A then quickly B and assert A cannot win the race; correct a mark only for the open session id; collapse still works.
- Confidence: high
- Coordinator validation: accepted — independently confirmed the split nullables, missing session-id guard on the expand row, and `handleCorrect` targeting `expandedId` while cards iterate `expanded.session.picks`.

### F2 — Spreadsheet probe as accessible | missing | error

- Subsystem: S8 Google Sheets platform bridge
- Verdict: recommend
- Evidence:
  - `web/src/services/sheetsClient.ts:114-121` — `spreadsheetExists` returns boolean; 404 and 403 both become `false`, and any other non-OK (401, 5xx) also becomes `false` via `return res.ok`.
  - `web/src/services/sheetsSync.ts:74-80` — `exportClassToSheet` treats missing id and `spreadsheetExists === false` the same: `createCheckpointSpreadsheet`.
  - `web/src/store.ts:254-255` — caller persists `summary.spreadsheetId`; a false-negative probe replaces the linked sheet.
- Current complexity or invalid states:
  One boolean stands in for accessible, confirmed-missing (404), forbidden (403), unauthorized (401), and server failure (5xx). Export therefore creates a replacement spreadsheet whenever the probe is not a clean 200, including cases where the linked sheet still exists.
- Proposed representation and why it is simpler:
  Probe as a 3-way result used by export: overwrite when accessible; create only when id is absent or the API confirms 404; fail (throw) on 401/403/5xx. A small union `{ status: 'ok' } | { status: 'missing' } | { status: 'error'; httpStatus: number }` (or an honest boolean that is false only on 404 and throws otherwise) matches the actual export decision.
- Smallest credible implementation scope:
  - Files: `web/src/services/sheetsClient.ts`, `web/src/services/sheetsSync.ts`
  - Interfaces: `spreadsheetExists` (or replacement `probeSpreadsheetAccess`), `exportClassToSheet`
- Regression risks and migration:
  Export that today silently mints a new sheet on 403/401/5xx would instead error and keep the previous id. Users who linked a sheet they cannot access would see a failure instead of a new spreadsheet. 404 and unset-id create paths stay the same. `spreadsheetExists` is only called from `exportClassToSheet`.
- Validation:
  - Existing: no dedicated tests for `sheetsClient` or `sheetsSync`.
  - Additional: probe 200 → accessible; 404 → missing; 401/403/5xx → error (not missing). `exportClassToSheet`: no id or 404 creates; accessible overwrites; 403/401/5xx does not create and does not return a new spreadsheetId.
- Confidence: high
- Coordinator validation: accepted — independently confirmed 403/404 both return false and export creates a new spreadsheet on any false, which `store.exportToSheets` then persists as the linked id.

### F3 — Session auto-draw latch keyed to class

- Subsystem: S11 Feature pages
- Verdict: recommend
- Evidence:
  - `web/src/pages/Session.tsx:31-42` — `autoPicked` is set true before `pickStudents` and on any restored draft; it is never reset when `selectedClassId` changes; `pickStudents()` is fire-and-forget.
  - `web/src/pages/Session.tsx:56-68` — any ready+selectedClassId mount with no `currentSession` renders "Drawing students…" with no error or retry.
  - `web/src/components/AppShell.tsx:50-56` — sidebar class switcher can change `selectedClassId` while Session stays mounted.
  - `web/src/store.ts:149-177` — `pickStudents` can return `'error'` or `'blocked'` after `busy.pick` clears; the page never reads that result.
- Current complexity or invalid states:
  Live meaning is spread across `autoPicked`, `currentSession`, and `busy.pick`. Reachable stuck state: `autoPicked=true`, `currentSession` undefined, `busy.pick=false` after switching to a class with no draft (effect deps include `selectedClassId`, but the ref is still true from the previous class). A failed pick leaves the same placeholder forever.
- Proposed representation and why it is simpler:
  Narrowed from a full page phase machine: key the auto-draw latch to `selectedClassId` (reset when the class changes) and await `pickStudents`, mapping `error`/`blocked` onto a failed empty state instead of a write-once ref. Restored drafts still count as already drawn. This removes "need to draw again" as an unrepresentable state without a new shared session FSM.
- Smallest credible implementation scope:
  - Files: `web/src/pages/Session.tsx`
  - Interfaces: auto-draw effect, empty/drawing/error UI. Do not change `pickStudents`, draft persistence, or AppShell.
- Regression risks and migration:
  First visit still auto-draws once; restored drafts must not double-draw; save/discard still navigate away without redraw (`Session.tsx:29-30`); redraw already has its own path.
- Validation:
  - Existing: `web/e2e/attendance.spec.ts` covers first draw, reload-restored marks, and a second session from Home. It does not switch class on `/session` or force a pick failure.
  - Additional: on `/session`, switch sidebar class to one with no draft and expect a new draw (or a failed state, not infinite Drawing). Restore a draft and assert no second `pickStudents`. Optional: pick error shows retry.
- Confidence: medium
- Coordinator validation: accepted, narrowed, demoted high→medium — independently confirmed the write-once ref is not reset on class change while AppShell keeps Session mounted; rejected a full `{ drawing | failed | live }` union as more than the smallest latch that removes the stuck state.

### F4 — Single selected class entity

- Subsystem: S7 App store / session orchestration
- Verdict: recommend
- Evidence:
  - `web/src/store.ts:42-45` — `selectedClassId`, `selectedClass`, `currentN`, and `currentSession` are independent optionals.
  - `web/src/store.ts:120-133` — `selectClass` writes the requested id even when `getClass` returns undefined (`cls` is `ClassEntity | undefined`).
  - `web/src/store.ts:140-141` — `deleteClass` has a defensive branch for `currentSession.classId` matching a class that is not selected.
  - `web/src/store.ts:239` — `updateSettings` refreshes `currentN` but not `selectedClass.defaultN`.
  - `web/src/store.ts:311-314` — draft autosave keys by `selectedClassId` without requiring `currentSession.classId` to match.
  - `web/src/pages/Home.tsx:83` — caller already dual-guards `selectedClassId && selectedClass`.
- Current complexity or invalid states:
  Reachable combinations include `selectedClassId` set with `selectedClass` undefined (getClass miss), `selectedClass.defaultN !== currentN` after a settings save, and `currentSession.classId !== selectedClassId` if `pickStudents` completes after a class switch — the subscribe then writes that draft under the wrong class key.
- Proposed representation and why it is simpler:
  Keep a single optional `selectedClass: ClassEntity` and derive the id from `selectedClass.id`. `selectClass` commits only when `getClass` returns an entity. Persist drafts only when `currentSession.classId === selectedClass.id`. This removes the dual-nullable pair and the orphan-session delete branch without a new public state machine. Do not nest a `ClassScope` object in this slice.
- Smallest credible implementation scope:
  - Files: `web/src/store.ts` (callers of `selectedClassId` in AppShell and pages switch to `selectedClass?.id`)
  - Interfaces: `StoreState.selectedClassId`, `StoreState.selectedClass`, `selectClass`, `deleteClass`, `useStore.subscribe` draft persistence
- Regression risks and migration:
  Every reader of `selectedClassId` (AppShell, Home, Session, Roster, History, Settings) must switch to `selectedClass?.id`. Fail-closed `selectClass` changes restore when a persisted id is missing: today a dangling id can remain, afterward selection becomes none. Rapid class switching should keep the last requested class. `currentN` stays a sibling field.
- Validation:
  - Existing: no dedicated store tests. Session/class flows are only covered indirectly by `web/e2e/attendance.spec.ts`.
  - Additional: unit-test `selectClass`: getClass miss leaves `selectedClass` undefined; subscribe does not write a draft under a mismatched class id. E2E: restore last class on reload; switch class with an unsaved draft and confirm the other class’s draft is unchanged.
- Confidence: medium
- Coordinator validation: accepted, demoted high→medium — dual fields and the draft-key mismatch are real; `init` already fail-closes missing ids, and `selectClass` callers pass ids from the classes list, so the getClass-miss path is uncommon. Overlapping `selectClass` is last-write-wins consistent, not an extra invalid pair.

### F5 — Exclusive in-flight operation slot

- Subsystem: S7 App store / session orchestration
- Verdict: recommend
- Evidence:
  - `web/src/store.ts:36-46` — `busy` is `Record<BusyKey, boolean>`, so pick, save, export, and import can all be true.
  - `web/src/store.ts:149-153` — `pickStudents` only rejects `busy.pick`, not save/import.
  - `web/src/store.ts:180-181` — `redrawRandom` only checks `busy.pick`, so it can replace `currentSession` while `saveSession` is persisting.
  - `web/src/store.ts:207-227` — `saveSession` never reads `busy`; on success it sets `currentSession` to undefined even if a newer pick landed.
  - `web/src/store.ts:264-306` — `previewImport` and `applyImport` both set `busy.import` without checking it, and `applyImport` clears the draft/session.
  - `web/src/pages/Session.tsx:76` — UI ORs `busy.pick || busy.save` on that page only; AppShell still allows navigation to Settings mid-save.
  - `web/src/pages/Settings.tsx:194-197` — UI ORs export/import, but that exclusion is not in the store.
- Current complexity or invalid states:
  Independent booleans allow pick+save (redraw/save wiping each other’s `currentSession`), overlapping preview/apply on the same import flag, and save+applyImport (apply clears the draft the in-flight save is writing). Session/Settings buttons serialize their local pairs; the store still permits the combinations across pages.
- Proposed representation and why it is simpler:
  Replace `busy` with a single exclusive slot, `inFlight: BusyKey | null`. Each orchestrated action no-ops or returns blocked/fail when `inFlight` is set, then holds the slot for its try/finally. That matches how Session and Settings already treat their local pairs and makes overlapping session/import mutations unrepresentable. Include `selectClass` abort-or-wait, or have `pickStudents` re-read `selectedClassId` before `set`, otherwise the mutex of only BusyKey still loses a class-switch-during-pick.
- Smallest credible implementation scope:
  - Files: `web/src/store.ts` (Session/Settings busy reads follow)
  - Interfaces: `StoreState.busy`, `setBusy`, `pickStudents`, `redrawRandom`, `saveSession`, `exportToSheets`, `previewImport`, `applyImport`
- Regression risks and migration:
  Call sites that read `busy.pick` / `busy.save` / `busy.export` / `busy.import` must compare against the single slot. Export/import/pick that used to run beside an in-flight save would now return blocked/fail. Do not reintroduce a global error field on the store.
- Validation:
  - Existing: no dedicated store tests. Buttons on Session/Settings are the only serialization today.
  - Additional: unit-test: save in flight makes pick/redraw return blocked and applyImport fail; a second preview/apply while import is held fails; `inFlight` is cleared in finally on both success and throw.
- Confidence: medium
- Coordinator validation: accepted, demoted high→medium — the boolean record and missing cross-op guards are real; Session/Settings already serialize the main buttons, so the remaining hole is cross-page navigation mid-op plus pick completing after a class switch. Exclusive slot is simpler than pairwise flags; export-vs-pick blocking is slightly broader than strictly required.

### F6 — One owner for the PWA manifest

- Subsystem: S12 Build, PWA, and test tooling
- Verdict: recommend
- Evidence:
  - `web/vite.config.ts:13-34` — VitePWA generates PWA identity (name, `#0b1017` colors, `logo-192.png` / `logo-512.png`) and is the documented owner of the generated SW.
  - `web/public/manifest.webmanifest:1-12` — a second Web App Manifest with `#ffffff` colors, `display`/`start_url`, and `/pwa-192x192.png` / `/pwa-512x512.png`, which are not in `web/public/`.
  - `web/index.html:5-6` — HTML theme-color and favicon match VitePWA colors and `logo-64.png`, not the static manifest.
  - `web/playwright.config.ts:19-24` — e2e serves `npm run dev`; VitePWA SW is off in dev by default, so neither manifest is asserted.
- Current complexity or invalid states:
  Plugin docs treat generated vs public-folder manifest as exclusive. Both are present, so `/manifest.webmanifest` can be leftover template or generated config depending on Vite public-copy vs plugin emit. That permits white vs dark theme, existing `logo-*` vs missing `pwa-*` icons, and `display`/`start_url` present only on the stale file.
- Proposed representation and why it is simpler:
  One owner: the VitePWA `manifest` object in `vite.config.ts`. Delete `web/public/manifest.webmanifest`. Fold `display: 'standalone'` and `start_url: '/'` into that object so installability is not stranded on the deleted file. Keep public `logo-*.png` as assets referenced only from that object (and `index.html` favicon/theme-color).
- Smallest credible implementation scope:
  - Files: `web/vite.config.ts`, `web/public/manifest.webmanifest`
  - Interfaces: `VitePWA({ manifest })`, built `/manifest.webmanifest`, `npm run build` / preview
- Regression risks and migration:
  Dev currently serves `public/manifest.webmanifest` at `/manifest.webmanifest`; after deletion, VitePWA's generated file is the only one. Installed PWAs may refresh colors/icons. If a host still expected `display`/`start_url` only from the static file, those fields must be copied into `vite.config`. No app TS types or IndexedDB schema change.
- Validation:
  - Existing: no PWA/manifest/SW tests. `web/e2e/attendance.spec.ts` golden path against the dev server; does not fetch `/manifest.webmanifest`.
  - Additional: `web/public/` has no `manifest.webmanifest`; `logo-192.png` and `logo-512.png` still exist. `vite preview` / `dist/manifest.webmanifest` matches `vite.config` (theme `#0b1017`, logo-* icons, display standalone, start_url `/`) and those icon URLs resolve.
- Confidence: high
- Coordinator validation: accepted — independently confirmed the static manifest points at missing `pwa-*.png` files (public/ has only `logo-*.png`) and disagrees on theme-color with `index.html` and VitePWA config.

### F7 — Collapse draft redraw inputs into one session

- Subsystem: S4 Session draft builder
- Verdict: recommend
- Evidence:
  - `web/src/domain/sessionDraft.ts:24-28` — `carryoverIdsOverride`, `baseSession`, and `resetMarks` are independently optional on `DraftSessionInputs`.
  - `web/src/domain/sessionDraft.ts:49,67-76` — carryover source, id/date/timestamps, and marks each branch on a different optional.
  - `web/src/domain/sessionDraft.test.ts:77-94` — the redraw test always sets all three together.
  - `web/src/domain/sessionDraft.test.ts:96-107` — override without `baseSession` is a third supported mode used only in tests.
  - `web/src/store.ts:186-191` — sole production caller binds the three fields as one redraw command; `resetMarks` is true iff marks exist.
- Current complexity or invalid states:
  Eight flag combinations exist; production uses two (fresh pick vs redraw-with-all-three). Unused mixes include `resetMarks` with no base, base without override (preserve id while recomputing carryovers), override without base (new id, pinned carryovers), and `baseSession` marks with `resetMarks` false (copied marks need not be a subset of the new picks).
- Proposed representation and why it is simpler:
  Replace the three fields with one optional `redrawFrom?: SessionEntity`. On redraw, take id/date/`createdAt`/`savedAt` and `carryoverIds` from that session and always emit `marks: {}`. Fresh pick keeps derived carryovers, `newId`/`now`, and empty marks. One optional, one branch, two real operations.
- Smallest credible implementation scope:
  - Files: `web/src/domain/sessionDraft.ts`, `web/src/domain/sessionDraft.test.ts`, mechanical field rename in `web/src/store.ts` `PickOptions`
  - Interfaces: `DraftSessionInputs`, `buildDraftSession`. Keep `DEFAULT_*` exports.
- Regression risks and migration:
  Ghost-roster coverage must move onto `redrawFrom.carryoverIds` (or a dummy session). Any untested caller that kept non-empty marks across a redraw, or preserved id while refreshing carryovers from ledger, would change; neither path exists in `store.ts`.
- Validation:
  - Existing: `sessionDraft.test.ts` covers fresh pick with derived carryovers, redraw keeping id/date/carryovers with `resetMarks`, ghost id drop via override, eligible-pool smaller than N, and invalid n falling back to `DEFAULT_N`.
  - Additional: redraw from a session with marks must yield `marks {}`. Ghost ids on `redrawFrom.carryoverIds` must still drop. Assert `carryoverIds ⊆ picks` and `Object.keys(marks) ⊆ picks` on both modes.
- Confidence: medium
- Coordinator validation: accepted — independently confirmed the three independent optionals, production `redrawRandom` always passing all three, and a test-only override-without-base mode. This is two real operations, not a type wrapping the same branches.

### F8 — Own `defaultN` only on settings

- Subsystem: S1 Shared domain types
- Verdict: recommend
- Evidence:
  - `web/src/types.ts:3-7` — `ClassEntity` carries `defaultN`.
  - `web/src/types.ts:62-64` — `PerClassSettings` also carries `defaultN`.
  - `web/src/data/repository.ts:21-24` — `createClass` writes `defaultN` only on the class row; no settings row.
  - `web/src/data/repository.ts:185-194` — `getEffectiveSettings` merges `settings?.defaultN ?? cls?.defaultN ?? DEFAULT_N`.
  - `web/src/data/repository.ts:214-217` — `updateSettings` mirrors `defaultN` onto the class row.
  - `web/src/data/repository.ts:243-252` — `replaceClassData` repeats the three-way fallback and mirrors onto the class row.
  - `web/src/services/sheetsSync.ts:110-121` — export writes `defaultN` on both the Settings row (with class fallback) and the Classes tab.
- Current complexity or invalid states:
  Two persisted numbers can disagree (`ClassEntity.defaultN !== PerClassSettings.defaultN`). New classes have only the class-row value; settings rows have their own copy. Callers cannot trust either field and must merge, then write both on every update/import.
- Proposed representation and why it is simpler:
  Own `defaultN` only on `PerClassSettings`. `ClassEntity` becomes `{ id, name }`. Until a settings row exists, readers use `DEFAULT_N`. This removes the dual-write invariant from the shared model; merge/mirror code becomes unnecessary rather than relocated.
- Smallest credible implementation scope:
  - Files: `web/src/types.ts`, `web/src/data/repository.ts`, `web/src/services/sheetsSync.ts`
  - Interfaces: `ClassEntity`, `PerClassSettings`, `createClass`, `getEffectiveSettings`, `updateSettings`, `replaceClassData`
- Regression risks and migration:
  IndexedDB class rows from v1 already store `defaultN`; dropping it from the type does not delete the Dexie field. Keep a one-time read of `cls.defaultN` only inside `getEffectiveSettings` until a settings row is created, or write a settings row in `createClass`. Sheets Classes tab still has a `defaultN` column; export should keep filling it from settings so old spreadsheets round-trip.
- Validation:
  - Existing: no dedicated tests for `types.ts`; no test asserts `ClassEntity.defaultN` vs `PerClassSettings.defaultN`.
  - Additional: `createClass` then `getEffectiveSettings` returns `DEFAULT_N` without a class-row fallback. `updateSettings({ defaultN })` changes only the settings row. `replaceClassData` / Sheets export use Settings.defaultN; Classes tab column remains a projection.
- Confidence: medium
- Coordinator validation: accepted — independently confirmed both types carry `defaultN`, `createClass` writes only the class row, and `updateSettings`/`replaceClassData` mirror onto the class row. Authoritative owner is S1; S6 skip recorded the same shape as a cross-note.

## Explicit skip decisions

| id | name | reason |
|---|---|---|
| S2 | Weighted sampling | 28-line pure sampler; `WeightedItem`/`SamplerOptions` have no invalid combinations. |
| S3 | Attendance / carryover domain | Pure ledger/session projections and two PRD-aligned queries; no invalid stored combinations inside this boundary. |
| S5 | Sheet import parse/validate | Discriminated `SheetImportResult` plus per-tab loops already match the model; stub session fields and `TabReport` counters are local noise. |
| S6 | Persistence (Dexie + repository) | Thin Dexie table-per-entity repository already matches the product model; ledger/session dual-write and settings fallbacks are intentional. `defaultN` dual field is owned by S1 (F8). |
| S9 | CSV roster I/O | Linear parse/map/unparse helper; `RosterRow` optionality matches untrusted CSV. |
| S10 | App shell, routing, chrome | Routes, AppShell, Dialog, and Toast are small and locally clear; leftover optionals are not observed as invalid combinations. |

## Cross-cutting patterns

- Dual `defaultN` on class vs settings — seen in S1, S6, S7 (`currentN`), S8 export; owned for action by S1 (F8). Store `currentN` is the live picking N and stays a sibling of selection (F4).
- Independent optionals for one interaction — seen in S4 redraw flags, S7 selection pair, S11 History expand; owned for action by S4 (F7), S7 (F4), S11 (F1) respectively. Do not invent a shared "optional pair" helper.
- Unkeyed async page snapshots (no classId/generation on loaded payload) — seen in Home stats, Roster, History, Settings (S11 notes); not promoted to a third S11 finding (cap 2). Fix locally with a classId guard if those pages race; do not add a shared page-data module.
- Class-required screens gated three ways (AppShell CSS-only `needsClass`, Session redirect, Roster/History/Settings empty-state) — seen in S10/S11; owned for action by none (not a representation win).
- S4 `PickOptions` in `store.ts` mirrors F7's three flags — mechanical caller update owned with F7, not a second S7 finding.
- S7 store pre-calls `getAccessToken(SHEETS_AND_DRIVE_SCOPES)` while `sheetsClient.fetchJson` always requests `SHEETS_SCOPES` — auth-scope split; not a representation change in this audit.

## Duplicates and superseded findings

| discarded | kept | reason |
|---|---|---|
| S1 Mark discriminated union (worker note) | none | Present+reason is ignored at call sites; product treats absence reason as optional. |
| S1 SessionEntity date/createdAt/savedAt collapse (worker note) | none | In-app logic uses `date`; createdAt/savedAt are Sheets round-trip fields. |
| S6 defaultN dual-write as an S6 finding | F8 | Source of truth is `types.ts`; repository only mirrors. |
| S7 unify PickStatus with ActionResult (worker note) | none | Stylistic; Session.tsx is the only consumer. |
| S11-2 full page phase machine | F3 | Narrowed to a class-keyed latch plus await; full `{ drawing \| failed \| live }` relocates the same branches. |
| S7-1 overlapping selectClass race as a distinct invalid pair | F4 remainder | Last completion is consistent; kept dual-nullable + draft-key mismatch only. |

## Final priorities and dependencies

| rank | id | impact | confidence | effort | blast radius | prerequisites | first slice? |
|---|---|---|---|---|---|---|---|
| 1 | F2 | Silent replacement of a linked spreadsheet on 403/401/5xx | high | small | `sheetsClient` + `exportClassToSheet` | none | yes |
| 2 | F1 | Wrong-session body and `correctMark` after expand switch/race | high | small | `History.tsx` only | none | yes |
| 3 | F3 | Stuck "Drawing students…" after sidebar class switch on `/session` | medium | small | `Session.tsx` only | none | no |
| 4 | F4 | Dual selection fields; draft can persist under the wrong class | medium | medium | store + every `selectedClassId` reader | none | no |
| 5 | F5 | Overlapping pick/save/import mutations still representable | medium | medium | store + Session/Settings busy reads | F4 (same file; do selection first) | no |
| 6 | F8 | Two persisted `defaultN` values and dual-write | medium | medium | types + repository + Sheets export | none | no |
| 7 | F6 | Generated vs static PWA identity disagree; missing icon files | high | small | vite PWA config + delete static manifest | none | no |
| 8 | F7 | Eight redraw flag combos; production uses two | medium | small | `sessionDraft` + mechanical `PickOptions` | none | no |

Best first implementation slices:

1. F2 — smallest destructive-path representation fix: 3-way probe, no UI rewrite, no schema migration.
2. F1 — smallest UI-state fix: one local union in `History.tsx` with a clear wrong-session failure mode.

## Audit log

| time | event | ids | notes |
|---|---|---|---|
| 2026-08-25 | coverage contract written | S1–S12 | 12 non-overlapping rows; no backend; generated SW owned by S12 |
| 2026-08-25 | batch 1 dispatched | S1, S6, S7, S8 | cheap-workers slug `cursor-grok-4.6-high-fast` |
| 2026-08-25 | batch 1 harvested | S1, S6, S7, S8 | S1-1; S6 skip; S7-1 + S7-2; S8-1 |
| 2026-08-25 | batch 2 dispatched | S3, S4, S5, S11 | same cheap slug |
| 2026-08-25 | batch 2 harvested | S3, S4, S5, S11 | S3 skip; S4-1; S5 skip; S11-1 + S11-2 |
| 2026-08-25 | batch 3 dispatched | S2, S9, S10, S12 | same cheap slug |
| 2026-08-25 | batch 3 harvested | S2, S9, S10, S12 | S2/S9/S10 skip; S12-1 |
| 2026-08-25 | independent verification | F1–F8 | accepted 8; narrowed S11-2; demoted S7-1, S7-2, S11-2 |
| 2026-08-25 | audit-the-audit | S1–S12 | coverage walk; no new subsystem row; production tree unchanged |

## Audit-the-audit

| pass | result | action taken |
|---|---|---|
| coverage / missing boundaries | no omitted production subsystem | Inspected `web/src/` (29 ts/tsx files), `web/e2e/`, `web/public/`, configs. `vite-env.d.ts` is a one-line Vite reference — not a subsystem. No server package. No generated OpenAPI. VitePWA SW remains S12. |
| duplication / ownership overlap | no shared file ownership | Colocated tests stay with S2–S5; e2e stays S12. `types.ts` consumed widely but owned only by S1. S1 F8 implementation touches S6/S8 files; authority stays S1. |
| materiality / over-abstraction | two demotions, one narrow | Dropped full Session phase machine (F3). Demoted S7 findings: UI already serializes main buttons; getClass-miss is uncommon. Kept F7 (two real operations) and F6 (dual generated-contract owners). |
| schema completeness | complete | Every inventory row is recommend or skip. Every accepted finding has eight worker fields plus coordinator validation. Empty sections use `none` where applicable. |
| dependency-aware ranking | F5 after F4 | Same store file; selection representation first. F2 and F1 marked first slices; neither assumes a later finding. |

Omitted subsystems added after coverage pass:

- none
