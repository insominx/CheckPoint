# Understand — State management (as referenced by `v1-code-quality-improvements.md`)

Goal: become expert-level on **everything in this repo that materially affects “state management” items called out in** `docs/archive/v1-code-quality-improvements.md`.

This report is **docs-first**, then anchored to **paths + symbols** in `web/src`.

---

## 0) Top 5 facts, Top 5 risks (anchored)

### Top 5 facts (load-bearing truths)
- **Single UI state owner is Zustand**: `useStore` in `web/src/store.ts` owns `selectedClassId`, `currentSession`, `currentN`, `isLoading`, `isPickingStudents`, `error` and exposes the “authorized” mutation actions.
  - Anchor: `web/src/store.ts` `export const useStore = create<Store>(...)`
- **Persistence boundary is split**:
  - **IndexedDB (Dexie)** for durable domain state: classes/students/sessions/ledger/settings via `db` (`CheckPointDB`).
  - **`localStorage`** for a draft (unsaved) session per class.
  - Anchors: `web/src/db.ts` `export class CheckPointDB extends Dexie`, `super('CheckPointDB')`; `web/src/store.ts` `useStore.subscribe(...)` and `restoreDraftSession()`
- **Ledger is the single source of truth for absences** (no cached counters): `StudentEntity.absenceCount` is deprecated and absence counts are derived from `db.ledger`.
  - Anchors: `web/src/types.ts` `StudentEntity.absenceCount` JSDoc deprecation; `web/src/store.ts` `getAbsenceCount()`
- **Correctness-critical multi-table updates are done in Dexie transactions**: saving sessions, deleting sessions, clearing history, deleting class, and correcting marks use `db.transaction('rw', ...)`.
  - Anchors: `web/src/store.ts` `saveSession()`, `deleteSession()`, `clearHistoryForClass()`, `deleteClass()`, `correctMark()`
- **Google auth/token “state” is module-scoped, not in the store** (explicitly deferred in the code quality doc).
  - Anchors: `web/src/google.ts` `let accessToken`, `let accessTokenExpiresAt`, `let grantedScopes`

### Top 5 risks (where state can go wrong)
- **Guard flag may block intended re-entry (Re-draw)**: `pickStudents()` is guarded by `canStartOperation(isPickingStudents, !!currentSession)`; because `currentSession` is set after the first pick, subsequent calls are blocked. `redrawRandom()` calls `pickStudents()` without clearing `currentSession`.
  - Anchors: `web/src/store.ts` `pickStudents()` guard; `web/src/store.ts` `redrawRandom()`
  - Blast radius: Session UI “Re-draw” becomes a no-op; users can’t regenerate random picks.
- **Absence count derivation is not class-scoped**: `getAbsenceCount(studentId)` counts ledger rows by `studentId` only (not `(classId, studentId)`), so identical IDs across classes will mix counts.
  - Anchor: `web/src/store.ts` `getAbsenceCount()`
  - Blast radius: Roster page and Sheets export `absenceCount` can be incorrect if IDs are reused across classes.
- **Authority is mixed in a few pages**: some pages still write/read directly from `db` (Dexie) rather than through store actions, which can cause stale UI state or bypass “one place to change” invariants.
  - Anchors: `web/src/pages/History.tsx` export button reads `db.ledger` + `db.students`; `web/src/pages/Settings.tsx` “Choose CSV Output” writes `db.settings.put`; `web/src/pages/Roster.tsx` roster import writes `db.students.put`
- **Import validation is partial**: `validation.ts` includes `validateSessionRow()` and `validateLedgerRow()`, but `importCurrentClassFromSheets()` only validates students; sessions/ledger are imported without validation beyond basic string coercions in the mapper.
  - Anchors: `web/src/validation.ts` `validateSessionRow`, `validateLedgerRow`; `web/src/store.ts` `importCurrentClassFromSheets()` mapping of `sessionsBody`/`ledgerBody`
- **Global “isLoading” is shared across unrelated operations**: concurrent long-running operations (e.g., Sheets sync + picking) can clobber `isLoading`/`error` and lead to confusing UI disabling.
  - Anchor: `web/src/store.ts` `set({ isLoading: true, error: undefined })` in multiple actions (e.g. `pickStudents()`, `exportCurrentClassToSheets()`, `importCurrentClassFromSheets()`)

---

## 1) Scope & assumptions

### Included
- Anything referenced by `docs/archive/v1-code-quality-improvements.md` under **State Management**, **Access Pattern Violations**, and **Safety Mechanisms** that affects state ownership/authority/persistence.
- The full “state surface” of the web app: Zustand store, Dexie DB schema, `localStorage` draft session, and Google auth token state.

### Excluded
- CSS/UI styling (except where it impacts state correctness/authority).
- Non-web artifacts under `rosters/` (unless referenced by code paths discussed here).

### Assumptions
- The user runs the app as a single-user offline-first SPA (no server).
- Student IDs *may* be reused across classes (especially if roster files provide stable IDs).

---

## 2) Relevant docs index (must-read vs nice-to-have)

### Must-read docs
- `docs/archive/v1-code-quality-improvements.md`
  - Why: explicit list of state-management-related issues/fixes; defines audit goals and deferred items.
- `docs/product/design-overview.md`
  - Why: describes intended state ownership (local-first), key entities, and the “ledger as truth” model.
- `README.md`
  - Why: confirms stack and entry expectations (`Zustand`, `Dexie`, offline-first).

### Nice-to-have docs
- `docs/product/prd.md`
  - Why: describes intended flows and derived concepts (carryovers/eligible), useful for checking invariants.

### Not included but considered
- `web/README.md`
  - Reason: Vite template content; not app-architecture-specific.

---

## 3) Dependency map (modules + boundaries)

### Package boundary
- App code lives under `web/` (Vite React SPA).

### State/logic module edges (who depends on whom)
- Pages (`web/src/pages/*.tsx`) → **`useStore`** (`web/src/store.ts`) for most data/actions.
- `web/src/store.ts` → `web/src/db.ts` (`db`) for persistence.
- `web/src/store.ts` → `web/src/google.ts` for Sheets operations + token handling.
- `web/src/store.ts` → `web/src/sampling.ts` for weighted sampling.
- `web/src/store.ts` → `web/src/sync.ts` for guard/conflict helpers.
- `web/src/store.ts` → `web/src/validation.ts` for import validation (currently students only).
- Some pages (`History.tsx`, `Settings.tsx`, `Roster.tsx`) → `web/src/db.ts` directly for helper operations (export / file handle / import).
- `web/src/utils/csv.ts` → `papaparse` for roster parsing + CSV export.

---

## 4) System overview (components, responsibilities, authority)

### State owners (who “owns” what)
- **Zustand store (`useStore`)** owns ephemeral UI state:
  - `selectedClassId`: current scope selector (class “context”).
  - `currentN`: sample size (mirrors class default).
  - `currentSession`: draft session (picks + marks) before save.
  - `isLoading`, `isPickingStudents`, `error`: operation/UI flags.
  - Anchor: `web/src/store.ts` `interface UIState`
- **Dexie DB (`db`)** owns durable domain state:
  - Tables: `classes`, `students`, `sessions`, `ledger`, `settings`.
  - Anchor: `web/src/db.ts` `CheckPointDB` tables + `this.version(...).stores(...)`
- **`localStorage`** owns draft persistence:
  - Key: `checkpoint_draft_session_<classId>`, content is serialized `SessionEntity`.
  - Anchors: `web/src/store.ts` `restoreDraftSession()` and autosave `useStore.subscribe(...)`
- **Module-level Google token state** owns cached auth credentials:
  - `accessToken`, `accessTokenExpiresAt`, `grantedScopes`.
  - Anchor: `web/src/google.ts` module globals + `getAccessToken()`

### Update authority (who is allowed to mutate)
- Intended authority per code quality doc: “go through store actions” for app state mutations.
  - Anchor: `docs/archive/v1-code-quality-improvements.md` “Access Pattern Violations (P2)”
- In practice:
  - **Store actions** mutate Zustand + Dexie for core flows (pick/save/history correction/sync).
  - **Some pages** mutate Dexie directly for convenience (CSV file handle in settings; roster import writes; history export reads).
  - Anchors: `web/src/pages/Settings.tsx`, `web/src/pages/Roster.tsx`, `web/src/pages/History.tsx`

---

## 5) Config/artifacts involved (+ where referenced)

- **IndexedDB name**: `CheckPointDB`
  - Anchor: `web/src/db.ts` `super('CheckPointDB')`
- **Draft session localStorage key**: `checkpoint_draft_session_<classId>`
  - Anchor: `web/src/store.ts` `localStorage.getItem(\`checkpoint_draft_session_${classId}\`)` and `localStorage.setItem(key, ...)`
- **Google OAuth client id**: `VITE_GOOGLE_CLIENT_ID`
  - Anchor: `web/src/google.ts` `import.meta.env.VITE_GOOGLE_CLIENT_ID`
- **Google Sheets schema header**: `CHECKPOINT_SETTINGS_HEADERS` and version `CHECKPOINT_SETTINGS_SCHEMA_VERSION`
  - Anchors: `web/src/google.ts` exports, used by `web/src/store.ts` export/import/repair flows

---

## 6) Load-bearing flows (state management deep dives)

### Flow A — Class selection & scoping (the “context root”)
- **Entry points**
  - UI: Home dropdown `onChange` → `selectClass(classId)`
  - Anchor: `web/src/pages/Home.tsx` `onChange={async (e) => { await selectClass(e.target.value) }}`
- **Control + data flow**
  - `selectClass()` sets `selectedClassId`, reads class from `db.classes`, sets `currentN`, then restores draft session.
  - Anchor: `web/src/store.ts` `selectClass()` + `restoreDraftSession()`
- **State owner / authority**
  - Owner: Zustand store.
  - Persistence boundary: reads Dexie (`classes`) and `localStorage` draft.
- **Invariants / ordering constraints**
  - `selectedClassId` must be set before any class-scoped actions return non-empty results (most actions early-return without it).
  - Draft session must match `draft.classId === selectedClassId` to be restored (basic guard).
  - Anchor: `web/src/store.ts` `getStudents()`, `getSessions()`, `getClassSettings()`, etc.
- **Failure modes**
  - Stale Home class list after external mutations (mitigated by reloading after create/delete).
  - Draft JSON parse failure → logged, draft ignored.

Text diagram:
```
Home.tsx select -> store.selectClass -> (db.classes.get) -> set currentN -> store.restoreDraftSession -> (localStorage) -> set currentSession?
```

### Flow B — Picking students (race safety + derived state)
- **Entry points**
  - Session page effect: if `!currentSession && selectedClassId` → `pickStudents()`
  - Anchor: `web/src/pages/Session.tsx` `useEffect(... pickStudents())`
  - Manual: “Generate Picks” button also calls `pickStudents()`
  - Anchor: `web/src/pages/Session.tsx` button `onClick={() => pickStudents()}`
- **Control + data flow**
  - Guard: `canStartOperation(isPickingStudents, !!currentSession)` blocks concurrent calls and (currently) blocks re-entry when a session already exists.
  - Data fetch: `students`, `sessions`, `ledger`, `settings` read from Dexie.
  - Derived computations:
    - Carryovers computed from ledger + session marks (most recent absent vs most recent present).
    - Eligible = never absent (not in `lastAbsentDateByStudent`).
    - Weights: “never seen” based on any marks; “cooldown” based on membership in last two sessions’ `picks`.
  - New `SessionEntity` created in-memory and stored in Zustand as `currentSession`.
  - Anchors: `web/src/store.ts` `pickStudents()`; helper guard: `web/src/sync.ts` `canStartOperation()`
- **State owner / authority**
  - Owner: Zustand store for `currentSession`.
  - Persistence boundary: reads Dexie tables; does not write until save.
- **Invariants**
  - Must be class-scoped (all reads are filtered by `classId`).
  - Carryover IDs must be subset of picks.
- **Failure modes**
  - Guard prevents redraw/re-pick while `currentSession` exists (see Risk #1).

Text diagram:
```
Session.tsx -> store.pickStudents
  -> guard (sync.canStartOperation)
  -> read db.students/db.sessions/db.ledger/db.settings
  -> derive carryovers/eligible/weights
  -> sampling.weightedSampleWithoutReplacement
  -> set currentSession (draft)
```

### Flow C — Marking + autosave drafts (localStorage)
- **Entry points**
  - Present/Absent buttons call `markStudent(studentId, mark)` in store.
  - Anchor: `web/src/pages/Session.tsx` `onClick={() => markStudent(...)}`
- **Control + data flow**
  - `markStudent()` stamps `markedAt` and updates `currentSession.marks` immutably in Zustand.
  - Autosave subscription persists `currentSession` to `localStorage` on every state update where both `currentSession` and `selectedClassId` exist.
  - Anchors: `web/src/store.ts` `markStudent()`; `web/src/store.ts` `useStore.subscribe(...)`
- **State owner / authority**
  - Owner: Zustand store; `localStorage` is a persistence mirror for drafts.
- **Invariants**
  - Draft key is scoped by `selectedClassId`.
  - Persisted draft should match selected class (restore checks that).
- **Failure modes**
  - No debounce: repeated marks cause repeated `localStorage` writes (probably fine at this scale).
  - Draft contains full `SessionEntity` JSON; schema changes could break restore.

Text diagram:
```
Session UI click -> store.markStudent -> set currentSession -> store.subscribe -> localStorage.setItem(checkpoint_draft_session_<classId>, JSON)
```

### Flow D — Save session (atomic persistence, derived ledger)
- **Entry points**
  - Session “Save” button → `saveSession()` then navigate Home.
  - Anchor: `web/src/pages/Session.tsx` Save `onClick`
- **Control + data flow**
  - `saveSession()` creates `sessionToSave` with timestamps.
  - Dexie transaction writes:
    - `db.sessions.add(sessionToSave)`
    - derived absent marks → `db.ledger.bulkAdd(absentEntries)`
  - Optional side effect: append absent rows to a chosen CSV file via File System Access API (`settings.csvFileHandle`).
  - Draft cleanup: remove `localStorage` draft; clear `currentSession` in Zustand.
  - Anchor: `web/src/store.ts` `saveSession()`
- **State owner / authority**
  - Owner: store orchestrates; Dexie is durable authority.
- **Invariants**
  - Ledger entries are derived only from marks with `status === 'absent'`.
  - `absenceCount` is not updated anywhere (must remain derived).
- **Failure modes**
  - CSV append failure is swallowed (debug logged), session still saves (intentional resiliency).

### Flow E — History correction (atomic session+ledger updates)
- **Entry points**
  - History expand → click correction buttons → `correctMark(sessionId, studentId, newStatus, reason)`
  - Anchor: `web/src/pages/History.tsx` `handleCorrect()` + store `correctMark`
- **Control + data flow**
  - Transaction ensures mark + ledger remain consistent:
    - Absent→Present: delete ledger rows for `(classId, sessionId, studentId)`.
    - Present→Absent: add ledger row.
    - Absent→Absent with reason change: update ledger reason.
  - Anchor: `web/src/store.ts` `correctMark()`
- **State owner / authority**
  - Durable authority: Dexie session + ledger.
  - UI state: History page local React state (`expandedId`, `expandedDetails`) reloaded after correction.
- **Invariants**
  - Ledger and session marks must agree for that session/student.
- **Failure modes**
  - If ledger has multiple matching rows, delete uses `bulkDelete` across them (safe but indicates potential duplication upstream).

### Flow F — Settings & sync state (per-class settings + remote sync)
- **Entry points**
  - Settings page loads via `getClassSettings()`, saves via `updateClassSettings()`.
  - Sheets operations via store: `exportCurrentClassToSheets()`, `importCurrentClassFromSheets()`, `repairCurrentClassSpreadsheetIdentity()`.
  - Anchors: `web/src/pages/Settings.tsx` calls; `web/src/store.ts` implementations; `web/src/google.ts` helpers/token.
- **Control + data flow (local settings)**
  - `updateClassSettings()` writes Dexie `settings` and also mirrors `defaultN` to `classes.defaultN` + store `currentN`.
  - Anchor: `web/src/store.ts` `updateClassSettings()`
- **Control + data flow (Sheets sync)**
  - Token state is module global (`google.ts`).
  - Export:
    - ensures sheets/tabs, validates identity, checks timestamp conflict (`shouldWarnAboutConflict`), clears sheets sequentially, writes entities, writes Settings row with schema version + export timestamp, persists `lastExportedAt` locally.
  - Import:
    - destructive overwrite within transaction (clear sessions/ledger/students/settings), then repopulate from sheet rows.
    - Student rows validated (`validateStudentRow`); sessions/ledger not validated.
  - Anchors: `web/src/store.ts` `exportCurrentClassToSheets()`, `importCurrentClassFromSheets()`; `web/src/sync.ts` `shouldWarnAboutConflict()`; `web/src/google.ts` token + sheet helpers.
- **Invariants**
  - Spreadsheet must match selected class identity (`probeCheckpointSpreadsheetIdentity`).
  - `lastExportedAt` is the optimistic lock “version”.
- **Failure modes**
  - Token scope changes are implicit via `grantedScopes` and `getAccessToken(scopes)`; failures surface via alerts.

---

## 7) Key data models / schemas / state machines

### Core entities (durable)
- `ClassEntity`: `web/src/types.ts` `interface ClassEntity`
- `StudentEntity` (note deprecated `absenceCount`): `web/src/types.ts` `interface StudentEntity`
- `SessionEntity`: `web/src/types.ts` `interface SessionEntity`
- `AbsenceLedgerItem`: `web/src/types.ts` `interface AbsenceLedgerItem`
- `PerClassSettings`: `web/src/types.ts` `interface PerClassSettings`

### Draft session lifecycle (state machine)
- **None** → `pickStudents()` sets `currentSession` (draft) → `markStudent()` updates marks → autosave writes to `localStorage` → `saveSession()` persists to Dexie + clears draft (`localStorage` + store).
  - Anchors: `web/src/store.ts` `pickStudents()`, `markStudent()`, subscribe autosave, `saveSession()`

---

## 8) Configuration and environment dependencies

- Google: `VITE_GOOGLE_CLIENT_ID` required for `getAccessToken()`.
  - Anchor: `web/src/google.ts` `import.meta.env.VITE_GOOGLE_CLIENT_ID`
- Browser features:
  - File System Access API is optional (`window.showSaveFilePicker`) and gated.
  - Anchor: `web/src/pages/Settings.tsx` “Choose CSV Output” button

---

## 9) Gotchas and footguns (state & async)

- **Re-draw likely blocked by the race guard** (see Risk #1).
- **Absence counts can cross class boundaries** via `getAbsenceCount(studentId)` (see Risk #2).
- **Mixed DB access patterns**: direct Dexie writes/read in pages make it easier to introduce subtle bugs if you assume store is the only authority.
- **Import validation is uneven**: sessions/ledger might accept malformed rows and still persist them.
- **Global loading flag collisions**: `isLoading` is shared for picks and sync operations; UI disabling can be surprising.

---

## 10) Open questions (anchored + what they block)

- **Is `redrawRandom()` expected to work today?** If yes, the current `canStartOperation(..., !!currentSession)` usage blocks it.
  - Anchors: `web/src/store.ts` `redrawRandom()`, `pickStudents()`, `web/src/sync.ts` `canStartOperation()`
  - Blocks: safe refactor guidance for race-guards vs redraw behavior.
- **Are student IDs guaranteed unique across classes?** If not, `getAbsenceCount()` should be class-scoped.
  - Anchors: `web/src/store.ts` `getAbsenceCount()`, `web/src/types.ts` `StudentEntity.id`
  - Blocks: correctness guarantee for roster “Absences” display and Sheets export.

---

## 11) Quick glossary (project-specific)

- **Store**: Zustand `useStore` in `web/src/store.ts` (UI state + mutation authority).
- **Ledger**: `db.ledger` table of `AbsenceLedgerItem` (single source of truth for absences).
- **Draft session**: unsaved `SessionEntity` persisted to `localStorage` as `checkpoint_draft_session_<classId>`.
- **Carryover**: derived concept computed from ledger + later Present marks (implemented in `store.pickStudents()` and tested in `attendance.ts`).

