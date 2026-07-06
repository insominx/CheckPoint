Last Edited: 2026-02-03

## 1) Contract
- **Behavior**
  - **Async UI state is per-operation** (not a single shared `isLoading`/`error`), so Sheets import/export/repair does not clobber Pick/Redraw UI state and vice versa.
  - **Sheets import is fail-closed on data integrity**: Sessions/Ledger/Marks are validated (not just Students) before any destructive local overwrite.
  - **Sheets import is non-destructive on validation failure**: if validation fails, **no local rows are deleted** and the user gets an actionable error summary.
  - **Sync operations emit a structured, bounded “sync report” artifact** for debugging and reproducibility (stored locally and optionally downloadable).

- **Non-goals**
  - Refactor the entire codebase to “store is the only writer” (page-level `db.*` exceptions may remain for now).
  - Change the product constraint that `studentId` must be globally unique across classes (Dexie schema change/migration is out of scope).
  - Add full E2E automation (Playwright) in this change set.

- **Acceptance checks (observable outcomes)**
  - **AC1**: While a Sheets export is running, Pick/Redraw controls show the correct busy/disabled state for their own operation (no unrelated spinner/disable), and any export error does not overwrite pick/redraw error messaging.
  - **AC2**: Sheets import rejects invalid session dates (e.g., non-ISO), invalid ledger rows (missing required fields), and malformed marks rows with a clear summary.
  - **AC3**: If Sheets import validation fails, existing local data for the class remains intact (no partial clears).
  - **AC4**: After Sheets import/export/repair, a sync report is available at a deterministic key (e.g., `checkpoint_last_sync_report_<classId>`) and includes identity probe output + row counts + validation stats.
  - **AC5**: Existing successful import/export flows still work on a known-good spreadsheet produced by the app.

- **Risk profile**
  - **Correctness**: High (import path is destructive; must not silently corrupt or delete data).
  - **Performance**: Medium (validation adds CPU/memory; must remain acceptable for typical class sizes).
  - **External integration**: High (Google Sheets is user-editable; schema drift and wrong-target operations are primary hazards).

---

## 2) Authority & state ownership
- **Owner (single authority) + decision point**
  - **Authority**: Zustand store (`web/src/store.ts`) remains the orchestration owner for domain + external sync operations.
  - **Decision points**:
    - Sheets export/import/repair: `exportCurrentClassToSheets`, `importCurrentClassFromSheets`, `repairCurrentClassSpreadsheetIdentity`
    - Pick/redraw: `pickStudents`, `redrawRandom`

- **Dependency direction (Input → Domain → Infrastructure)**
  - **UI pages** (`web/src/pages/*.tsx`) call **store actions** (Input).
  - Store uses **domain helpers** (`web/src/validation.ts`, `web/src/sync.ts`) and **infra helpers** (`web/src/google.ts`, Dexie `web/src/db.ts`) (Domain → Infrastructure).
  - New helpers introduced (if any) must be leaf-ish utilities (e.g., a `syncReport.ts` helper) to avoid circular imports.

- **State owners**
  - **Source of truth**: Dexie tables (`web/src/db.ts`), especially `db.ledger` for absences (per PRD/design).
  - **Cache / derived**: absence counts and carryovers are derived; avoid persisting new derived caches.
  - **Persisted artifacts**: draft sessions in `localStorage` (`checkpoint_draft_session_<classId>`); new sync report in `localStorage` with size caps.

- **Persistence boundaries**
  - **IndexedDB writes**: must be within Dexie transactions for destructive flows (`importCurrentClassFromSheets`, `saveSession`, `correctMark`).
  - **Sheets API I/O**: must remain guarded by identity checks (`probeCheckpointSpreadsheetIdentity` in `web/src/google.ts`) before any overwrite/clear.
  - **LocalStorage writes**: must be bounded (size/time) and should not block critical UI; sync report should be small and truncated.

---

## 3) Proposed approach (smallest viable change)
### Phase A — Per-operation async state (reduce UI clobbering)
- **Add an operation-scoped status model** in `web/src/store.ts`:
  - Replace/augment `UIState.isLoading` + `UIState.error` with:
    - `opStatus: Record<string, { inProgress: boolean; error?: string; startedAt?: string; finishedAt?: string }>`
    - (or equivalent typed union keyed by: `pick`, `save`, `exportSheets`, `importSheets`, `repairSheets`, `deleteClass`, etc.)
- **Update actions** in `web/src/store.ts` to set/clear their own op keys instead of globally clobbering one flag.
- **Update UI consumers** (`web/src/pages/Session.tsx`, `web/src/pages/Settings.tsx`, and any global spinners) to use the relevant op status.
- **Why this is the correct authority**: only store actions know the true operation lifecycle and concurrency constraints.

### Phase B — Fail-closed validation + staged import (protect destructive import)
- **Implement “validate first, then commit” flow** inside `importCurrentClassFromSheets` (`web/src/store.ts`):
  - Parse all tabs (`Students`, `Sessions`, `Marks`, `Ledger`, `Settings`) as today.
  - **Validate and normalize** into in-memory entities:
    - Students: keep existing `validateStudentRow` (`web/src/validation.ts`).
    - Sessions: apply `validateSessionRow` (already exists) and then populate `picks/carryoverIds/marks` from parsed columns.
    - Ledger: apply `validateLedgerRow` (already exists).
    - Marks: add `validateMarkRow` (new) in `web/src/validation.ts` (required fields + enumerated status + optional reason + markedAt ISO check if present).
  - **Referential integrity checks** (store-level, after row validation):
    - Every `mark.studentId` exists in imported students.
    - Every `ledger.studentId` exists in imported students.
    - Every `mark.sessionId` exists in imported sessions (or drop marks when session missing; MVP should **fail-closed**).
  - Only if validation passes: run the Dexie transaction that clears + bulkAdds (current destructive overwrite).
- **Why this is the correct authority**: store owns the destructive overwrite boundary and can ensure no local deletion happens before validation.

### Phase C — Sync report artifact (turn Unknowns into evidence)
- **Create a small report builder** (new file suggested: `web/src/syncReport.ts` or local helper in store):
  - Versioned report (e.g., `SyncReportV1`) including:
    - operation name, timestamps, classId/spreadsheetId
    - identity probe result (`SpreadsheetIdentityProbe` from `web/src/google.ts`)
    - row counts per tab read
    - validation stats + sample errors (bounded list)
    - result (`ok`/`blocked`/`failed`) + error message
- **Emit report** at the end of import/export/repair (in `finally`), storing to:
  - `localStorage['checkpoint_last_sync_report_<classId>']`
  - Cap size (truncate sample errors, omit large row payloads; no full student roster dump).
- **Optional UI**: add a “Copy last sync report” button on Settings (future-friendly; can be minimal).
- **Why this is the correct authority**: store already has full context (identity probe + validation stats + errors).

### Complexity avoided
- Don’t introduce a full state machine framework; simple op-scoped status is enough.
- Don’t build multi-scope Sheets support; keep “single class per sheet” constraints as enforced today.
- Don’t migrate Dexie schema or change global `studentId` uniqueness constraints.

---

## 4) Impacted surfaces
- **UI**
  - `web/src/pages/Session.tsx`: busy/disabled state and error display for pick/redraw/save (as applicable).
  - `web/src/pages/Settings.tsx`: busy/disabled state and error display for Sheets operations; optional “sync report” access.

- **Domain**
  - `web/src/validation.ts`: add `validateMarkRow` and possibly helper functions for ISO validation of `markedAt`.
  - `web/src/sync.ts`: optional extension if we standardize op guards beyond `canStartOperation`.

- **Infrastructure**
  - `web/src/google.ts`: likely unchanged for MVP (identity probing is already strong); may be referenced for report identity fields.

- **State/orchestration**
  - `web/src/store.ts`: primary changes (opStatus model, import staged validation/commit, sync report emission).

- **Docs**
  - `docs/guidelines/external-sync-safety-guidelines.md`: no change required, but plan aligns with “fail closed by default”.

---

## 5) Edge cases & failure modes
- **E1 Rapid interaction**: user clicks Pick, then immediately starts Sheets export.
  - **Intended behavior**: both ops reflect their own busy state; no shared flag clobber; operations may be blocked if policy says “one op at a time”.
- **E2 Import with invalid session date**
  - **Failure mode**: **hard-fail import** with validation summary; no local deletion.
- **E3 Import with ledger rows referencing unknown students**
  - **Failure mode**: **hard-fail import**; user sees “dangling studentId” errors.
- **E4 Import with duplicated IDs (students/sessions/ledger)**
  - **Failure mode**: **hard-fail import**; report shows duplicates and counts.
- **E5 Legacy sheet missing identity metadata**
  - **Intended behavior**: import remains blocked (current behavior); export/repair remains the path forward.
- **E6 Large roster**
  - **Intended behavior**: validation runs within reasonable time; report includes elapsed time; if slow, we consider chunking later.
- **E7 Marks rows with unknown status**
  - **Failure mode**: validation rejects; report includes sample offending rows (sanitized).
- **E8 Shared `error` messaging**
  - **Intended behavior**: per-op error stored with op key; UI shows error in the relevant pane only.

---

## 6) Verification plan
- **Unit tests**
  - Extend `web/src/validation.test.ts`:
    - `validateMarkRow` coverage (status enum, reason parsing, markedAt ISO).
    - `validateSessionRow`/`validateLedgerRow` used in import-style data shapes.
  - Add/extend tests for “staged import” helper(s) if extracted from store (preferred for testability).

- **Manual checks (browser)**
  - Run app, select class with existing history.
  - Start Pick/Redraw while triggering Sheets export; verify UI states don’t clobber.
  - Attempt import from:
    - known-good sheet exported by app (should succeed)
    - intentionally edited sheet with invalid date (should fail, no local deletion)
    - sheet with dangling IDs (should fail, no local deletion)
  - Verify sync report is created/updated and bounded in size.

- **Evidence mapping to acceptance checks**
  - **AC1**: UI screenshots or observed behavior (busy flags remain scoped).
  - **AC2/AC3**: import error message + confirm local sessions/ledger/students still present afterward.
  - **AC4**: inspect `localStorage` key for report, verify fields and size cap.
  - **AC5**: successful round-trip export → import using a fresh class.

---

## 7) Open questions / missing info
- **Q1**: Do we want to allow “best-effort import” (skip invalid rows) as an explicit override, or strictly fail-closed always?
  - **Blocks**: validation policy and user-facing UX copy.
- **Q2**: Should we enforce “one operation at a time” globally (mutex), or allow concurrent ops with per-op flags?
  - **Blocks**: whether to implement a generalized op runner or just status separation.
- **Q3**: Where should the sync report be surfaced (Settings UI button vs console-only vs downloadable file)?
  - **Blocks**: UI scope and minimal implementation footprint.
