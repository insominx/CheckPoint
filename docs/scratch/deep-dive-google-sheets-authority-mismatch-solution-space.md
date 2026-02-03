Last Edited: 2026-02-03
Topic: Google Sheets as single source of truth + roster mismatch risk
Inputs: `README.md`, `web/README.md`, `docs/design_overview.md`, `docs/attendance_spot_check_web_app_draft_prd.md`, `docs/implementation_plan_simplified.md`, `docs/code_quality_analysis.md`, `docs/access-patterns-plan.md`, `docs/sync-hazards-plan.md`, `docs/safety-mechanisms-plan.md`, `docs/code-smells-plan.md`, `docs/web-development-testing-guidelines.md`, `docs/scratch/understand-google-sheets-roster-mismatch.md`, `web/src/pages/Settings.tsx`, `web/src/store.ts`, `web/src/google.ts`, `web/src/db.ts`, `web/src/types.ts`, `web/src/pages/Home.tsx`, `web/src/pages/Roster.tsx`, `web/src/sync.ts`, `web/src/validation.ts`

### 0) Executive synthesis (dense)

- The product currently treats IndexedDB as the operational source of truth, with Google Sheets as optional backup/export/import, which conflicts with the requested "Sheets is authoritative" model (`web/src/store.ts`, `docs/design_overview.md`, `docs/attendance_spot_check_web_app_draft_prd.md`).
- The Settings "Open Spreadsheet" flow uses the stored `spreadsheetId` with no class-identity validation; a wrong ID opens a different class roster without warning (`web/src/pages/Settings.tsx`, `web/src/google.ts`).
- Import/export are class-scoped but destructive; a mismatched sheet ID can overwrite local data or display a roster that does not match the selected class (`web/src/store.ts`).
- Schema drift exists for the Settings sheet: headers list 4 columns, export writes 5 (adds `lastExportedAt`), which can undermine conflict detection clarity (`web/src/google.ts`, `web/src/store.ts`).
- There are no UI affordances showing which class is active in Settings, increasing the chance of using the wrong sheet or class (`web/src/pages/Settings.tsx`, `web/src/pages/Home.tsx`).

- Known: Sheets integration uses per-class `spreadsheetId` stored in IndexedDB settings (`web/src/store.ts`, `web/src/types.ts`, `web/src/db.ts`).
- Known: Export writes only the selected class’s data to the sheet tabs and persists `spreadsheetId` + `lastExportedAt` locally (`web/src/store.ts`).
- Known: Import overwrites local data for the selected class using the sheet tabs (`web/src/store.ts`, `web/src/validation.ts`).
- Unknown: How often users reuse a single spreadsheet across multiple classes (no telemetry; **Unknown**).
- Unknown: Whether mismatch happens due to class selection drift, stale settings, or shared sheet IDs (needs diagnostics; **Unknown**).

### 1) Problem definition + scope boundaries

- In scope:
  - Making Google Sheets the authoritative source for rosters and class data.
  - Preventing mismatches between the selected class in the UI and the sheet that opens or syncs.
  - Diagnosing mismatch causes within Settings / sync flows.
- Out of scope:
  - Google API reliability, authentication consent UX, network errors.
  - SIS integrations or multi-user concurrency beyond sheet edits.

- Glossary:
  - `selectedClassId`: active class in UI/store (`web/src/store.ts`, `web/src/pages/Home.tsx`).
  - `spreadsheetId`: sheet ID stored per class settings (`web/src/types.ts`, `web/src/store.ts`).
  - “Sheets authoritative”: the sheet is the primary data source; web is a view/cache.

- Observable symptoms:
  - The sheet opened from Settings shows a different roster than the web Roster page.
  - After sync/import, local roster changes in unexpected ways (overwrites or missing students).
  - The sheet tab data appears for a different class than the selected class.

### 2) Current state (ground truth)

- Class selection and class-scoped data are controlled by `selectedClassId` in the store (`web/src/store.ts`, `web/src/pages/Home.tsx`).
- Settings loads per-class settings from IndexedDB and stores `spreadsheetId` in local state (`web/src/pages/Settings.tsx`, `web/src/store.ts`, `web/src/db.ts`).
- Export uses the selected class, ensures sheets, clears tabs, then writes class-specific data (`web/src/store.ts`, `web/src/google.ts`).
- Import is destructive for the selected class and does not validate class IDs for sessions/ledger (`web/src/store.ts`, `web/src/validation.ts`).
- The UI does not indicate the active class on Settings, and Open Spreadsheet does not verify class identity (`web/src/pages/Settings.tsx`).

### 3) Edge-case taxonomy (must be explicit)

- EC1 (Structural ambiguity): `spreadsheetId` is valid but belongs to a different class; sheet opens “successfully” but roster mismatches (`web/src/pages/Settings.tsx`).
- EC2 (Semantic ambiguity): Sheet has multiple class rows in `Classes` tab, but app assumes single-class sheet and writes only one class (`web/src/store.ts`).
- EC3 (Mutation/coupling blast radius): Import overwrites local data for selected class even if sheet data is for another class (`web/src/store.ts`).
- EC4 (Tool behavior pitfall): Settings header has 4 columns, export writes 5 (timestamp), causing silent drift for downstream parsing or manual edits (`web/src/google.ts`, `web/src/store.ts`).
- EC5 (State drift): User edits `spreadsheetId` in UI but does not click Save; Open Spreadsheet uses unsaved value (`web/src/pages/Settings.tsx`).
- EC6 (Identity drift): Class selection changed in Home, Settings still shows previous class context (no explicit class label) (`web/src/pages/Home.tsx`, `web/src/pages/Settings.tsx`).
- EC7 (Open-but-weird): Sheets tab structure exists but Settings row doesn’t match class; open works but roster differs (`web/src/google.ts`, `web/src/store.ts`).
- EC8 (Won’t open / needs repair): Sheets API exists check fails (trashed or 403), causing recreate or failed sync; user may still open old sheet URL manually (`web/src/google.ts`).
- EC9 (Normalization pitfall): User pastes full URL or shortened ID; `normalizeAndValidateSpreadsheetId` accepts different formats but not class identity (`web/src/google.ts`).
- EC10 (Multi-class reuse): Same `spreadsheetId` saved for multiple classes; export overwrites the same tabs (class switching hazard) (`web/src/store.ts`).

### 4) Solution space (the corpus)

Option 1: Enforce class identity check before open/export/import
- Idea: Read `Settings` or `Classes` tab and ensure `classId` matches `selectedClassId`; warn or block on mismatch.
- What it changes: `web/src/pages/Settings.tsx` Open handler; `web/src/store.ts` export/import; `web/src/google.ts` read helper.
- Pros: Directly prevents mismatched roster confusion; aligns with “Sheets authoritative.”
- Cons: Adds network call latency; requires sheet to be reachable to open.
- Failure modes/risks: If Sheets unavailable, user cannot open; must provide override.
- Phase fit: MVP.

Option 2: Display active class name/id prominently on Settings
- Idea: Render class name and classId in Settings header to reduce user error.
- What it changes: `web/src/pages/Settings.tsx`, `web/src/store.ts` `getClassSettings()`.
- Pros: Low effort; reduces accidental mismatch.
- Cons: Does not enforce correctness; only mitigates user mistakes.
- Failure modes/risks: Still allows wrong `spreadsheetId`.
- Phase fit: MVP.

Option 3: “Sheets-first” mode toggle (read-only local)
- Idea: Add a mode where local data is read-only and always refreshed from Sheets.
- What it changes: `web/src/store.ts` (block writes), `web/src/pages/*` actions, possibly `db.ts` usage.
- Pros: Aligns with Sheets as authority; simplifies consistency.
- Cons: Requires network availability; conflicts with offline-first design in docs.
- Failure modes/risks: Offline usage breaks; user blocked without connectivity.
- Phase fit: Later phase unless offline requirement is relaxed.

Option 4: Automatic background refresh from Sheets on class selection
- Idea: On `selectClass`, fetch sheet and refresh local cache (or show “stale”).
- What it changes: `web/src/store.ts` `selectClass()`, `importCurrentClassFromSheets()`.
- Pros: Keeps web roster aligned with Sheets without explicit import.
- Cons: Destructive overwrite on selection is risky; needs safe merge or staging.
- Failure modes/risks: Accidental data loss if wrong sheet ID; must add safeguards.
- Phase fit: Later phase with staging safeguards.

Option 5: Store `classId` fingerprint in Settings tab and validate
- Idea: Write a dedicated `classId` and `className` row that must match.
- What it changes: `web/src/store.ts` export/import; `web/src/google.ts` header definition.
- Pros: Simple, explicit identity check; supports validation UI.
- Cons: Requires schema change; older sheets missing fields need migration.
- Failure modes/risks: Manual edits can break identity; needs repair path.
- Phase fit: MVP if migration is minimal.

Option 6: One spreadsheet per class enforced by creation flow
- Idea: On create or save, always create a new sheet per class; block reuse.
- What it changes: `web/src/pages/Settings.tsx` create/save; `web/src/google.ts`.
- Pros: Prevents cross-class overwrites; clear ownership.
- Cons: Removes flexibility; users may want shared sheets.
- Failure modes/risks: Users with existing multi-class sheets are blocked.
- Phase fit: MVP if requirement is strict.

Option 7: Support multi-class in a single spreadsheet with strict scoping
- Idea: Allow multiple class rows and read/write only rows matching `selectedClassId`.
- What it changes: `web/src/store.ts` export/import logic; `web/src/google.ts` schema.
- Pros: Supports shared sheet; still avoids overwrites if scoped correctly.
- Cons: More complex row filtering; risk of partial parsing errors.
- Failure modes/risks: Class scoping bugs could intermix data.
- Phase fit: Later phase.

Option 8: Add a “Sheet Preview” step before open/import
- Idea: Read `Classes` and `Students` headers and show class name + student count before action.
- What it changes: `web/src/pages/Settings.tsx`, `web/src/google.ts` read helpers.
- Pros: High-signal validation; user can confirm correct sheet.
- Cons: Extra step; requires auth and network.
- Failure modes/risks: If Sheets down, preview fails; needs fallback.
- Phase fit: MVP.

Option 9: Add change journal + reconciliation view
- Idea: Log sheet sync actions and show diffs (roster added/removed).
- What it changes: `web/src/store.ts`, local Dexie table for sync logs, Settings UI.
- Pros: Provides transparency; reduces confusion about mismatches.
- Cons: More UI and data work; adds storage.
- Failure modes/risks: Logs can be noisy without filtering.
- Phase fit: Later phase.

Option 10: Treat Sheets as “upstream,” local as cache with staleness indicator
- Idea: Store `lastSyncAt` and show “data stale” badge if local data older than sheet.
- What it changes: `web/src/store.ts` sync flows, Settings UI.
- Pros: Preserves offline-first behavior while prioritizing Sheets.
- Cons: Still allows divergence; requires sync metadata.
- Failure modes/risks: Users may ignore stale warning.
- Phase fit: MVP.

Option 11: Lock local editing unless connected to Sheets
- Idea: Disable roster import/editing unless `spreadsheetId` validated and online.
- What it changes: `web/src/pages/Roster.tsx`, `web/src/store.ts`.
- Pros: Enforces sheet authority strongly.
- Cons: Opposes offline-first goals; can block legitimate local workflows.
- Failure modes/risks: Teachers without network are blocked.
- Phase fit: Later phase; only if offline-first de-prioritized.

Option 12: Versioned sync + optimistic concurrency on import
- Idea: Require matching sheet version or user confirmation before overwrite; write back a version token.
- What it changes: `web/src/store.ts` import/export; `web/src/google.ts` Settings schema.
- Pros: Detects mismatch and races; consistent with conflict detection in export.
- Cons: Adds version field management; older sheets need migration.
- Failure modes/risks: Token drift from manual edits; needs repair.
- Phase fit: MVP if version field is added alongside identity check.

### 5) Trade-off matrix (forced clarity)

| Option | Complexity | Semantics risk | Determinism risk | Blast radius risk | MVP compatibility | Debuggability | Testability |
|---|---|---|---|---|---|---|---|
| 1) Identity check | Low | Low | Low | Low | High | High | High |
| 2) Show class label | Low | Low | Low | Low | High | High | High |
| 3) Sheets-first mode | Medium | Medium | Medium | Medium | Medium | Medium | Medium |
| 4) Auto-refresh on select | Medium | Medium | Medium | High | Low | Medium | Medium |
| 5) Class fingerprint | Medium | Low | Low | Low | High | High | High |
| 6) Enforce one sheet | Low | Medium | Low | Low | High | High | High |
| 7) Multi-class sheet | High | High | Medium | Medium | Low | Medium | Low |
| 8) Sheet preview step | Medium | Low | Low | Low | High | High | High |
| 10) Staleness badge | Low | Medium | Low | Low | High | Medium | High |
| 12) Version token | Medium | Low | Low | Low | Medium | High | Medium |

### 6) Diagnostics & evidence plan (make it falsifiable)

- Fast probe:
  - Log `selectedClassId`, `spreadsheetId`, and `Classes` tab first row on Settings open and on Sync button click.
  - Files: `web/src/pages/Settings.tsx`, `web/src/store.ts`, `web/src/google.ts`.
- Deep probe:
  - Add a "Verify Sheet" action that reads `Classes`, `Students`, and `Settings` tabs and reports classId, className, student count.
  - Files: `web/src/pages/Settings.tsx`, `web/src/google.ts`.

- Proposed JSON artifact (localStorage or console):
  - Key: `checkpoint_sheet_probe_<classId>`
  - Shape: `{ classId, spreadsheetId, sheetClassId, sheetClassName, studentCount, settingsRow, timestamp }`
  - Emission points: Open Spreadsheet, Sync, Import.

### 7) Hazard scoring + policy mapping

- H0 (No hazard): Sheet classId matches `selectedClassId`; required tabs present.
  - Policy: allow open/sync/import.
- H1 (Low): Sheet reachable but Settings row missing; classId unknown.
  - Policy: warn, allow open but block import unless confirmed.
- H2 (Medium): Sheet classId exists and does not match selected class.
  - Policy: block import/export; warn on open; offer “use anyway” only after explicit confirmation.
- H3 (High): Sheet missing required tabs or access denied.
  - Policy: block import/export; offer repair (create sheets) or re-auth.

- Mitigations that reduce hazard:
  - Identity check + class fingerprint (Options 1, 5, 12) reduce H2/H3 incidence.
  - Staleness badge (Option 10) does not reduce hazard; it only re-labels it.

### 8) Minimal experiments to choose direction

- Experiment 1: Add class label in Settings and measure mismatch reports.
  - Setup: Display class name + id; log when user opens sheet.
  - Signal: Fewer manual mismatch reports; if unchanged, mismatch likely technical.
  - Falsifies: If mismatch persists, UI confusion is not the only cause.

- Experiment 2: Implement sheet identity probe (read Settings/Classes row) and log mismatches.
  - Setup: On Open/Sync, read sheet classId and compare.
  - Signal: % of mismatches and root cause classification.
  - Falsifies: If mismatches are rare, prioritize simpler UX fixes.

- Experiment 3: Add “Preview Sheet” step before import.
  - Setup: Show class name + student count from sheet.
  - Signal: User cancels on mismatch, indicating UI misunderstanding.
  - Falsifies: If users proceed despite mismatch, need stronger enforcement.

- Experiment 4: Prototype “one sheet per class” enforcement.
  - Setup: Block saving an ID already mapped to another class.
  - Signal: Reduction in cross-class overwrites.
  - Falsifies: Users require shared sheets; block causes friction.

- Experiment 5: Add version token to Settings tab and validate on import/export.
  - Setup: Write `lastExportedAt` header explicitly, compare on import.
  - Signal: Conflicts caught early, fewer overwrites.
  - Falsifies: If tokens missing or inconsistent, need migration flow.

### 9) “MVP honest” framing (no overcommitment)

- Do now (safety + observability first):
  - Add class label in Settings (Option 2).
  - Add identity check on open/export/import (Option 1).
  - Align Settings header schema with `lastExportedAt` (Option 5/12 light).
- Needs more evidence:
  - Multi-class spreadsheet support (Option 7).
  - Sheets-first mode that disables local edits (Option 3/11).
  - Automatic background refresh on class selection (Option 4).
