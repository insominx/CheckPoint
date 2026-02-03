# Understand: Google Sheets roster mismatch from Settings

0) Top 5 facts, Top 5 risks

Top 5 facts
- `selectedClassId` is the global class context set by `selectClass()` and used by per-class reads/writes like `getStudents()`, `getClassSettings()`, and `exportCurrentClassToSheets()` in `web/src/store.ts`.
- The Settings UI loads per-class settings into local state and uses that `spreadsheetId` state to build the "Open Spreadsheet" URL in `web/src/pages/Settings.tsx`.
- Per-class settings, including `spreadsheetId`, are persisted in IndexedDB under the `settings` table keyed by `classId` in `web/src/db.ts` and written via `updateClassSettings()` in `web/src/store.ts`.
- Export to Google Sheets uses `settings.spreadsheetId` as a preferred ID, creates or reuses a spreadsheet, then writes only the selected class's data to Sheets and persists `spreadsheetId` + `lastExportedAt` in `web/src/store.ts` `exportCurrentClassToSheets()`.
- Import from Google Sheets uses the `spreadsheetId` stored for the selected class, reads Sheets data, and overwrites local students/sessions/ledger for that class in `web/src/store.ts` `importCurrentClassFromSheets()`.

Top 5 risks
- No class-identity check is performed before opening or exporting to a spreadsheet; any valid `spreadsheetId` is accepted, so a sheet from another class can be opened or overwritten without warning (`web/src/pages/Settings.tsx` Open handler, `web/src/store.ts` `exportCurrentClassToSheets()`, `web/src/google.ts` `ensureCheckpointSheets()` only validates tabs).
- Settings UI does not display the active class name, so it is easy to open a sheet while a different class is selected in the store (`web/src/pages/Settings.tsx` only shows "Settings" and no class label; class selection is in `web/src/pages/Home.tsx`).
- Import is destructive and does not validate sessions/ledger class IDs; a wrong `spreadsheetId` can wipe local data and import cross-class history (`web/src/store.ts` `importCurrentClassFromSheets()`).
- Spreadsheet schema definitions list four Settings columns, but export writes five columns (includes `lastExportedAt`), which can cause silent schema drift (`web/src/google.ts` `createAndInitSpreadsheetForCheckPoint()` and `ensureCheckpointSheets()` vs `web/src/store.ts` `exportCurrentClassToSheets()`).
- Settings page writes `db.settings` directly for spreadsheet ID and CSV handle without going through store state updates, which can make UI state diverge from store expectations in other components (`web/src/pages/Settings.tsx` direct `db.settings.put()` vs `web/src/store.ts` `updateClassSettings()`).

1) Scope & assumptions
- In scope: class selection state, Settings page behavior, `spreadsheetId` persistence, open/export/import flows, roster display for the selected class.
- Out of scope: Google API availability, network failures, auth consent UX, and spreadsheet content edits performed outside the app (except where they affect class identity).
- Assumption: each class is intended to have its own spreadsheet (per design overview).
- Assumption: the issue is reproducible without code changes and is driven by state or settings, not by external API outages.

2) Relevant docs index

Must-read docs (minimal set)
- `docs/design_overview.md` — Defines multi-class behavior, per-class settings, and Sheets integration expectations.
- `docs/sync-hazards-plan.md` — Details Sheets export safety (timestamp conflict, sequential clears).
- `docs/access-patterns-plan.md` — Notes direct DB access in Settings and recommended store actions.
- `docs/code_quality_analysis.md` — Summarizes Sheets sync changes and settings access exceptions.

Nice-to-have docs
- `docs/safety-mechanisms-plan.md` — Import validation and autosave context; relevant for import risks.
- `docs/attendance_spot_check_web_app_draft_prd.md` — Product intent for multi-class and sync behavior.

Not included but considered
- `docs/web-development-testing-guidelines.md` — Testing guidance, not specific to Sheets/class mismatch.
- `docs/implementation_plan_simplified.md` — Roadmap, no direct behavior details.

3) Dependency map (modules and package boundaries)
- `web/src/pages/Settings.tsx` -> `web/src/store.ts` (actions) + `web/src/google.ts` (auth/helpers) + `web/src/db.ts` (direct settings writes).
- `web/src/pages/Roster.tsx` -> `web/src/store.ts` (getStudents/getAbsenceCount) + `web/src/db.ts` (CSV import write).
- `web/src/store.ts` -> `web/src/db.ts` (Dexie) + `web/src/google.ts` (Sheets API) + `web/src/sync.ts` (conflict/guard logic) + `web/src/validation.ts` (import validation).
- `web/src/google.ts` -> Google Identity Services + Google Sheets/Drive APIs + env `VITE_GOOGLE_CLIENT_ID` (`web/.env.local`).
- `web/src/db.ts` -> Dexie/IndexedDB (persistent storage).

4) System overview (components, responsibilities, state owners)
- UI pages: `Home` selects class; `Settings` manages per-class settings and Sheets actions; `Roster` displays students for selected class (`web/src/pages/*.tsx`).
- State owner (UI): Zustand store holds `selectedClassId`, `currentN`, and `currentSession` (`web/src/store.ts`).
- State owner (persistent): IndexedDB via Dexie stores `classes`, `students`, `sessions`, `ledger`, `settings` (`web/src/db.ts`).
- External state: Google Sheets serves as optional external backup; Google Identity Services provides OAuth tokens (`web/src/google.ts`).
- Update authority: store actions (`selectClass`, `updateClassSettings`, `exportCurrentClassToSheets`, `importCurrentClassFromSheets`) and direct DB writes in Settings/roster CSV import.

5) Config/artifacts involved (and references)
- IndexedDB database `CheckPointDB` with tables `classes`, `students`, `sessions`, `ledger`, `settings` (`web/src/db.ts`).
- Local storage draft sessions under `checkpoint_draft_session_<classId>` (`web/src/store.ts` subscription).
- Google OAuth Client ID in `web/.env.local` (`VITE_GOOGLE_CLIENT_ID`) read by `web/src/google.ts`.
- Google Sheets tabs: `Classes`, `Students`, `Sessions`, `Marks`, `Ledger`, `Settings` (`web/src/google.ts`).

6) Load-bearing flows (3–7)

Flow 1: Class selection -> class-scoped state
- Entry point(s): Home page class selector (`web/src/pages/Home.tsx`), `selectClass()` action (`web/src/store.ts`).
- Text flow: Home select -> `selectClass(classId)` -> set `selectedClassId` -> load class -> set `currentN` -> restore draft session.
- Data flow: `classId` drives queries in `getStudents()`, `getSessions()`, `getClassSettings()`, export/import.
- State owner(s) + update authority: Zustand store `selectedClassId` updated only by `selectClass()`; persistence in Dexie `classes` table.
- Invariants: `selectedClassId` must reference an existing class; all per-class operations assume this.
- Failure modes/blast radius: wrong `selectedClassId` leads to Settings/roster/export actions for the wrong class; multi-page mismatch.
- Tests: none covering class selection or cross-page consistency (no UI tests).

Flow 2: Settings page load/save (per-class settings)
- Entry point(s): Settings mount `useEffect` -> `getClassSettings()` (`web/src/pages/Settings.tsx`).
- Text flow: selected class -> load class + settings -> populate local state -> user edits -> `updateClassSettings()` on Save.
- Data flow: `db.settings.get(classId)` -> UI state -> `db.settings.put()` (via store or direct DB call).
- State owner(s) + update authority: IndexedDB `settings` is source of truth; Settings page maintains local state; store `updateClassSettings()` writes to DB.
- Invariants: `settings.classId` matches `selectedClassId`; `spreadsheetId` belongs to the selected class.
- Failure modes/blast radius: stale local state or direct DB writes bypassing store can lead to inconsistent UI; wrong `spreadsheetId` saved causes sheet mismatch.
- Tests: none for Settings load/save or per-class settings integrity.

Flow 3: Open spreadsheet from Settings
- Entry point(s): Settings "Open Spreadsheet" button (`web/src/pages/Settings.tsx`).
- Text flow: click -> normalize `spreadsheetId` -> build URL -> `window.open()`.
- Data flow: local `spreadsheetId` state -> URL construction.
- State owner(s) + update authority: local React state for `spreadsheetId`; persisted in `db.settings` when saved.
- Invariants: `spreadsheetId` is valid and corresponds to selected class.
- Failure modes/blast radius: opening a spreadsheet for another class (or stale data) gives the appearance of roster mismatch; no guard or indicator of current class.
- Tests: none.

Flow 4: Export current class to Sheets
- Entry point(s): Settings "Sync to Google Sheets" / "Full Recreate & Sync" (`web/src/pages/Settings.tsx`) -> `exportCurrentClassToSheets()` (`web/src/store.ts`).
- Text flow: ensure auth -> read class + settings -> ensure spreadsheet -> ensure tabs -> conflict check -> clear sheets -> append class, student, session, ledger, settings rows -> persist `spreadsheetId` and `lastExportedAt`.
- Data flow: Dexie `classes/students/sessions/ledger/settings` -> Sheets tabs -> Dexie `settings`.
- State owner(s) + update authority: store action orchestrates; Google Sheets is external persistence; DB is local persistence.
- Invariants: spreadsheet contains only one class's data; `Settings` row corresponds to `selectedClassId`.
- Failure modes/blast radius: wrong `spreadsheetId` overwrites another class's sheet; conflict detection depends on Settings column E; partial failures marked in sheets; user may see mismatched roster if export used a sheet tied to another class.
- Tests: `web/src/sync.test.ts` validates conflict logic only; no tests for export behavior.

Flow 5: Import current class from Sheets
- Entry point(s): Settings "Import from Google Sheets (overwrite)" (`web/src/pages/Settings.tsx`) -> `importCurrentClassFromSheets()` (`web/src/store.ts`).
- Text flow: ensure auth -> read all tabs -> begin transaction -> clear local class data -> import students (validated) -> import sessions/marks/ledger -> update settings if row matches class.
- Data flow: Sheets tabs -> local Dexie tables (destructive overwrite).
- State owner(s) + update authority: store action drives; DB is overwritten; Sheets is the source for this flow.
- Invariants: imported rows belong to the selected class; rows are schema-compliant.
- Failure modes/blast radius: wrong sheet ID clears local class data; sessions/ledger are not validated by class; invalid data can be imported.
- Tests: none for import; validation utilities are unit-tested but sessions/ledger are not validated in import.

7) Key data models / schemas / state machines
- `ClassEntity` (`web/src/types.ts`): `id`, `name`, `defaultN`.
- `PerClassSettings` (`web/src/types.ts`): `classId`, `defaultN`, `neverSeenWeight`, `cooldownWeight`, optional `spreadsheetId`, `lastExportedAt`.
- `StudentEntity` (`web/src/types.ts`): `id`, `classId`, name fields, identifiers.
- `SessionEntity` + `Mark` (`web/src/types.ts`): `classId`, `picks`, `marks`; sessions connect to ledger.
- `AbsenceLedgerItem` (`web/src/types.ts`): append-only log; absence count derived from ledger.
- Google Sheets schema (`web/src/google.ts`): tabs with headers; Settings tab lacks `lastExportedAt` header even though export writes it.

8) Configuration and environment dependencies (packages, env vars, external services)
- Env: `VITE_GOOGLE_CLIENT_ID` required for auth (`web/.env.local`, `web/src/google.ts`).
- External services: Google Identity Services script (`https://accounts.google.com/gsi/client`) and Sheets/Drive APIs (`web/src/google.ts`).
- Persistence: IndexedDB via Dexie; per-class settings and spreadsheet IDs stored locally (`web/src/db.ts`).

9) Gotchas and footguns (async timing, state pitfalls)
- `spreadsheetId` is local UI state and can be changed without saving; "Open Spreadsheet" uses the unsaved value (`web/src/pages/Settings.tsx`).
- No class label in Settings makes it easy to open/export under the wrong selected class (`web/src/pages/Settings.tsx` vs class selection in `web/src/pages/Home.tsx`).
- Export assumes one class per spreadsheet; sharing IDs across classes overwrites the same tabs (`web/src/store.ts` `exportCurrentClassToSheets()`).
- Import clears local class data before any cross-class validation (`web/src/store.ts` `importCurrentClassFromSheets()`).
- Settings schema drift (`lastExportedAt` column) can confuse conflict detection if headers are manually edited (`web/src/google.ts`, `web/src/store.ts`).

10) Open questions (blocking decisions)
- Should we enforce a class-identity check before opening or exporting a spreadsheet?
  - Location: `web/src/pages/Settings.tsx` (Open handler)
  - Snippet: `const url = \`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit\``
  - Decision blocked: whether to warn or block if the sheet’s Settings row classId does not match `selectedClassId`.
- Should Settings display the active class name/id on the page?
  - Location: `web/src/pages/Settings.tsx`
  - Snippet: `<h2>Settings</h2>`
  - Decision blocked: UI change to reduce class-context confusion when opening Sheets.
- Do we want to support multi-class data in a single spreadsheet or enforce one spreadsheet per class?
  - Location: `web/src/store.ts` `exportCurrentClassToSheets()`
  - Snippet: `if (clsRow) await appendRows(spreadsheetId, 'Classes', [[clsRow.id, clsRow.name, clsRow.defaultN]])`
  - Decision blocked: schema/design for Sheets to prevent cross-class overwrites.
- Should the Settings sheet header include `lastExportedAt` explicitly?
  - Location: `web/src/google.ts` `createAndInitSpreadsheetForCheckPoint()`
  - Snippet: `Settings: ['classId','defaultN','neverSeenWeight','cooldownWeight'],`
  - Decision blocked: whether to align schema with conflict detection column usage.

11) Quick glossary (project-specific meanings)
- selectedClassId: Global store value indicating the active class (`web/src/store.ts`).
- spreadsheetId: Google Sheets ID stored per class in `PerClassSettings` (`web/src/types.ts`, `web/src/store.ts`).
- Export: Writes local class data to a Google Sheet and records `lastExportedAt` (`web/src/store.ts`).
- Import: Overwrites local class data from a Google Sheet (`web/src/store.ts`).
- Settings tab: Google Sheet tab used for per-class settings and conflict timestamps (`web/src/google.ts`).
