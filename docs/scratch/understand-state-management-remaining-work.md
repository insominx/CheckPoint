Last Edited: 2026-02-03

# Understand — State management (remaining work)

## 0) Top 5 facts, Top 5 risks (anchored)

### Top 5 facts (load-bearing truths)
- **Single UI state owner is Zustand**: `useStore` owns the active scope (`selectedClassId`), draft session (`currentSession`), and UI flags (`isLoading`, `isPickingStudents`, `error`).  
  - Anchor: `web/src/store.ts` `interface UIState`, `export const useStore = create<Store>(...)`
- **Durable state lives in IndexedDB via Dexie**: `CheckPointDB` tables are `classes`, `students`, `sessions`, `ledger`, `settings`.  
  - Anchor: `web/src/db.ts` `class CheckPointDB extends Dexie` + `.stores(...)`
- **Absence ledger is the source of truth**: absences are appended to `db.ledger` on save/corrections; absence counts are derived from ledger per class.  
  - Anchors: `web/src/store.ts` `saveSession()` bulk-adds ledger items; `web/src/store.ts` `correctMark()` updates ledger; `web/src/store.ts` `getStudentsWithAbsenceCounts()`
- **Draft sessions are persisted per class in `localStorage`** under `checkpoint_draft_session_<classId>` and restored on class selection.  
  - Anchor: `web/src/store.ts` `restoreDraftSession()` + `useStore.subscribe(...)` autosave
- **Google Sheets integration is guarded by “identity before I/O”**: export/import/open validate sheet identity via `probeCheckpointSpreadsheetIdentity()` and block mismatches/multi-class sheets.  
  - Anchors: `web/src/store.ts` `exportCurrentClassToSheets()` / `importCurrentClassFromSheets()`; `web/src/pages/Settings.tsx` “Open Spreadsheet” handler; `web/src/google.ts` `probeCheckpointSpreadsheetIdentity()`

### Top 5 risks (where state can go wrong)
- **Mixed update authority**: several pages still read/write Dexie directly (`db.*`) instead of routing through store actions, increasing the chance of bypassing invariants.  
  - Anchors: `web/src/pages/Settings.tsx` `db.settings.put(...)`, `db.classes.get(...)`; `web/src/pages/Roster.tsx` `db.students.put(...)`; `web/src/pages/History.tsx` export reads `db.ledger` + `db.students`
- **Single global `isLoading`/`error` flag is shared by unrelated operations** (picking vs Sheets export/import/repair), so concurrent ops can clobber UI state and messages.  
  - Anchor: `web/src/store.ts` `set({ isLoading: true, error: undefined })` in `pickStudents()`, `exportCurrentClassToSheets()`, `importCurrentClassFromSheets()`, `repairCurrentClassSpreadsheetIdentity()`
- **Sheets import validation is partial**: `validation.ts` provides `validateSessionRow()` and `validateLedgerRow()`, but `importCurrentClassFromSheets()` only validates **students**, then bulk-adds sessions/ledger via string coercion.  
  - Anchors: `web/src/validation.ts` `validateSessionRow`, `validateLedgerRow`; `web/src/store.ts` `importCurrentClassFromSheets()` (students validated; sessions/ledger bulkAdd mapped)
- **`StudentEntity.absenceCount` deprecation guidance is stale**: `types.ts` still says “Use `getAbsenceCount()`”, but the store no longer exposes it; counts are provided via `getStudentsWithAbsenceCounts()`.  
  - Anchors: `web/src/types.ts` `StudentEntity.absenceCount` JSDoc; `web/src/store.ts` `Actions` list (no `getAbsenceCount`, has `getStudentsWithAbsenceCounts`)
- **Google auth token state is module-scoped global**: `google.ts` caches token/scopes in module-level variables, which is harder to test/isolate and was explicitly deferred as a code-quality item.  
  - Anchor: `web/src/google.ts` module globals `accessToken`, `accessTokenExpiresAt`, `grantedScopes`

---

## 1) Scope & assumptions

### Included
- State ownership, authority boundaries, and persistence boundaries for the SPA under `web/`.
- Correctness/lifecycle issues in class scoping, draft persistence, and sync import/export.
- What remains to do to reduce state-management risk (not feature roadmap items like “history filters”).

### Excluded
- UI styling and layout (except where it reflects state ownership, e.g., disabling controls).
- E2E setup/tooling (this repo currently runs unit tests via Vitest only).

### Assumptions
- Single-user, local-first operation is the default; Sheets is optional backup (`docs/product/design-overview.md`).
- “Per-class” is the scoping boundary for all domain operations (sessions/ledger/students/settings) (`docs/product/prd.md`).

---

## 2) Relevant docs index (paths + why)

### Must-read
- `docs/product/prd.md`: defines “per-class” semantics; roster import constraints; persistence boundaries.
- `docs/product/design-overview.md`: intended architecture; “ledger as single source of truth”; testing guidance for modules.
- `docs/guidelines/external-sync-safety-guidelines.md`: normative “identity before I/O” rules for Sheets-like remotes.
- `docs/archive/v1-code-quality-improvements.md`: documents what was fixed vs what remains deferred (P3).

### Nice-to-have
- `docs/implementation/implementation-plan.md`: current implementation status and remaining gaps.
- `docs/guidelines/web-testing-guidelines.md`: test strategy guidance (unit vs integration vs E2E).

### Not included but considered
- `README.md`: useful overview, but currently references older doc paths (`docs/design_overview.md`, etc.) and is not authoritative for internal state mechanics.

---

## 3) Dependency map (modules and package boundaries)

Package boundary:
- App is a Vite SPA under `web/`.

Key dependency edges:
- Pages (`web/src/pages/*.tsx`) → store (`web/src/store.ts`) for scoped reads/writes (primary pattern).
- Store (`web/src/store.ts`) → Dexie DB (`web/src/db.ts`) for persistence.
- Store (`web/src/store.ts`) → domain helpers (`web/src/attendance.ts`, `web/src/sampling.ts`, `web/src/sync.ts`, `web/src/validation.ts`).
- Store + Settings UI → Google helpers (`web/src/google.ts`) for OAuth + Sheets operations.
- Pages with direct DB access:
  - `web/src/pages/Roster.tsx` → `db.students` (import).
  - `web/src/pages/Settings.tsx` → `db.settings` (csvFileHandle), `db.classes` (sheet title).
  - `web/src/pages/History.tsx` → `db.ledger` + `db.students` (CSV export).

Public-ish API surfaces:
- `useStore` actions in `web/src/store.ts`.
- Pure helper functions (unit tested): `web/src/attendance.ts`, `web/src/sampling.ts`, `web/src/sync.ts`, `web/src/validation.ts`, `web/src/google.ts` (parsing/identity derivation).

---

## 4) System overview (components and responsibilities)

### State owners
- **UI working state**: Zustand store (`web/src/store.ts`).
- **Durable local**: IndexedDB via Dexie (`web/src/db.ts`).
- **Draft persistence**: `localStorage` per class (`web/src/store.ts` subscribe + `restoreDraftSession()`).
- **External remote**: Google Sheets (optional) via `web/src/google.ts` + store orchestration.

### Update authority (who is allowed to mutate)
- **Authority (preferred)**: store actions mutate Dexie + UI state (sessions/ledger/settings/class deletion/sync).
- **Known exceptions**: a few page-level “utility” operations still use `db` directly (Roster import, Settings csvFileHandle, History export).

---

## 5) Config/artifacts involved (+ where referenced)

- **IndexedDB DB name**: `CheckPointDB`  
  - Anchor: `web/src/db.ts` `super('CheckPointDB')`
- **Draft session key**: `checkpoint_draft_session_<classId>`  
  - Anchor: `web/src/store.ts` `restoreDraftSession()` + autosave subscription
- **Google OAuth client id**: `VITE_GOOGLE_CLIENT_ID`  
  - Anchor: `web/src/google.ts` `import.meta.env.VITE_GOOGLE_CLIENT_ID`
- **Sheets identity contract**: `CHECKPOINT_SETTINGS_HEADERS`, `CHECKPOINT_SETTINGS_SCHEMA_VERSION`  
  - Anchor: `web/src/google.ts`

---

## 6) Load-bearing flows (state management)

### Flow 1 — Class selection establishes scope root
Text diagram:
```
Home select -> store.selectClass(classId)
  -> set selectedClassId
  -> db.classes.get(classId) -> set currentN
  -> restoreDraftSession() -> maybe set currentSession
```
- Entry points: `web/src/pages/Home.tsx` class dropdown `onChange`; `web/src/store.ts` `selectClass()`
- State owner(s): store (`selectedClassId`, `currentN`, `currentSession`)
- Invariants:
  - Class-scoped reads must return empty when `selectedClassId` unset (`getStudents`, `getSessions`, etc.).
- Failure modes:
  - Stale draft restored for wrong class is prevented by `draft.classId === classId` check (store-side).

### Flow 2 — Pick students / redraw (draft session lifecycle)
Text diagram:
```
Session mount -> pickStudents()
  -> buildDraftSession (reads students/sessions/ledger/settings for class)
  -> derive carryovers + eligible + weights
  -> set currentSession (draft)
Re-draw -> redrawRandom() -> pickStudents({ allowExistingSession: true, ... })
```
- Entry points: `web/src/pages/Session.tsx` effects + “Generate Picks”/“Re-draw” buttons
- Authority: `web/src/store.ts` `pickStudents()` + `redrawRandom()`
- Invariants:
  - Reads are class-scoped (store queries filter by `classId`).
  - Guarding uses `isPickingStudents` + `canStartOperation(...)` (`web/src/sync.ts`).
- Failure modes:
  - Shared `isLoading` can disable controls during unrelated Sheets operations.

### Flow 3 — Marking students + autosave to localStorage
Text diagram:
```
UI click -> store.markStudent -> update currentSession.marks
  -> store.subscribe -> localStorage.setItem(checkpoint_draft_session_<classId>, JSON)
```
- Entry points: `web/src/pages/Session.tsx` Present/Absent buttons; store `markStudent()`
- State owners: store + localStorage mirror
- Failure modes:
  - No debounce: frequent marks → frequent localStorage writes (likely OK at this scale).

### Flow 4 — Save session (Dexie transaction + ledger append)
Text diagram:
```
Save -> store.saveSession()
  -> transaction: sessions.add + ledger.bulkAdd(absentEntries)
  -> (optional) write rows to csvFileHandle
  -> localStorage.removeItem(draftKey); clear currentSession
```
- Entry points: `web/src/pages/Session.tsx` Save button; `web/src/store.ts` `saveSession()`
- Persistence boundary: Dexie transaction for atomicity
- Failure modes:
  - CSV file handle write is best-effort (failure logged, session still saves).

### Flow 5 — History corrections (atomic session+ledger consistency)
Text diagram:
```
History correct -> store.correctMark()
  -> transaction: update sessions.marks
  -> add/remove/update ledger rows keyed by (classId, sessionId, studentId)
```
- Entry points: `web/src/pages/History.tsx` expanded session correction buttons
- Authority: `web/src/store.ts` `correctMark()`
- Failure modes:
  - If duplicates exist in ledger for same triple, deletes will remove them all (safe, but indicates upstream issue).

### Flow 6 — Roster: read derived counts + import roster CSV (identity constraints)
Text diagram:
```
Roster load -> store.getStudentsWithAbsenceCounts()
  -> db.students (class) + db.ledger (class) -> countAbsencesByStudent -> render

Roster import -> parseRosterCsv -> toStudentEntities
  -> preflight duplicates + cross-class collisions (bulkGet)
  -> transaction: students.put(...)
```
- Entry points: `web/src/pages/Roster.tsx`
- Authority:
  - Reads: store action `getStudentsWithAbsenceCounts()` (`web/src/store.ts`)
  - Writes: page-level direct `db.students.put(...)` with preflight (`web/src/pages/Roster.tsx`)
- Invariants:
  - Current schema keys students by `id` globally (`web/src/db.ts`), so imports must fail-closed on cross-class collisions.

### Flow 7 — Sheets sync/import/repair (identity before I/O)
Text diagram:
```
Settings UI -> store.exportCurrentClassToSheets()
  -> ensure sheets/tabs -> probe identity -> clear sheets -> append rows -> persist lastExportedAt

Settings UI -> store.importCurrentClassFromSheets()
  -> probe identity -> read tabs -> transaction: clear local class tables -> bulkAdd imported rows
```
- Entry points: `web/src/pages/Settings.tsx` buttons; `web/src/store.ts` actions; `web/src/google.ts` helpers
- Invariants:
  - Identity must be verified before destructive overwrite (`probeCheckpointSpreadsheetIdentity` checks; blocks mismatch).
- Current gap:
  - Import validation only applies to students; sessions/ledger validation helpers exist but aren’t used.

---

## 7) Key data models / schemas / state machines

- `StudentEntity` has `id` + `classId`, but Dexie PK is `id` (global namespace).  
  - Anchors: `web/src/types.ts` `StudentEntity`; `web/src/db.ts` `students: 'id, classId, displayName'`
- `SessionEntity` has `createdAt`, `date`, `savedAt` (multiple timestamps).  
  - Anchor: `web/src/types.ts` `SessionEntity`
- `AbsenceLedgerItem` is append-only log; corrections mutate by deleting/updating rows.  
  - Anchors: `web/src/types.ts` `AbsenceLedgerItem`; `web/src/store.ts` `saveSession()`, `correctMark()`

---

## 8) Configuration and environment dependencies

- Browser-only APIs:
  - File System Access API (CSV output file handle) in `web/src/pages/Settings.tsx`
- External services:
  - Google Identity Services script + Sheets/Drive APIs in `web/src/google.ts`

---

## 9) Gotchas and footguns (especially async timing and authority)

- **Authority drift**: if more pages start writing via `db.*` directly, invariants (identity checks, conflict checks, state resets) can be bypassed.
- **Shared `isLoading`** can make UI “feel random” when Sheets ops disable session picking, or vice versa.
- **Import safety**: identity checks are strong, but row-level validation for sessions/ledger is still weak during import.

---

## 10) Open questions (anchored + what decision each blocks)

- **Should we eliminate remaining direct Dexie mutations in pages?**  
  - Anchors: `web/src/pages/Roster.tsx` import writes; `web/src/pages/Settings.tsx` csvFileHandle writes  
  - Blocks: whether to invest in strict “store is the only writer” refactor vs keeping documented exceptions.
- **Should Sheets import validate sessions + ledger (fail-closed) before destructive overwrite?**  
  - Anchors: `web/src/validation.ts` `validateSessionRow`/`validateLedgerRow`; `web/src/store.ts` `importCurrentClassFromSheets()`  
  - Blocks: safest next step for state correctness under external data hazards.
- **Do we want to split `isLoading` into per-operation flags?**  
  - Anchor: `web/src/store.ts` multiple actions set `isLoading`  
  - Blocks: clarity + avoiding cross-feature UI interference.
- **Should we update the `StudentEntity.absenceCount` deprecation text?**  
  - Anchor: `web/src/types.ts` JSDoc  
  - Blocks: keeping docs/types truthful for future contributors.

---

## 11) Quick glossary (project-specific)

- **Store**: Zustand `useStore` in `web/src/store.ts` (UI state + orchestration authority).
- **Ledger**: `db.ledger` table of `AbsenceLedgerItem` (source of truth for absences).
- **Draft session**: unsaved `SessionEntity` persisted to `localStorage` under `checkpoint_draft_session_<classId>`.
- **Identity before I/O**: verify remote sheet class identity before any destructive overwrite/import.

