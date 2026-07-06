# v1 Code Quality Improvements (Updated Audit)

> **Status**: ✅ Completed (Jan 2026 audit)  
> **Period**: January 2026  
> **Updated audit**: February 3, 2026

This document consolidates the v1 code quality audit and tracks follow-up fixes and remaining issues as of the updated February 2026 audit.

---

## Executive Summary (Feb 2026 audit)

High-priority synchronization issues remain resolved. Since the January audit, additional state-management fixes landed (per-operation status and fail-closed Sheets import validation). Remaining items are listed below and scoped to low/medium risk.

### Current audit snapshot

**Resolved since January 2026**
- **Per-operation UI status** via `opStatus` in `web/src/store.ts` (removes global `isLoading`/`error` clobbering).
- **Fail-closed Sheets import**: validate Students/Sessions/Marks/Ledger + referential integrity before destructive overwrite (`importCurrentClassFromSheets`).
- **Sync report artifact** written to `localStorage['checkpoint_last_sync_report_<classId>']` after Sheets export/import/repair.

**Open items (Feb 2026)**
- **Mixed update authority** remains: `web/src/pages/Roster.tsx` writes via `db.students`, `web/src/pages/Settings.tsx` stores CSV handle via `db.settings`, and `web/src/pages/History.tsx` reads `db.ledger` + `db.students` directly.
- **Stale `StudentEntity.absenceCount` guidance**: `web/src/types.ts` still references `getAbsenceCount()`, which no longer exists (counts are provided by `getStudentsWithAbsenceCounts()` in the store).
- **Module-scoped Google auth state** remains in `web/src/google.ts` (`accessToken`, `accessTokenExpiresAt`, `grantedScopes`).
- **Model cleanup debt**: redundant `carryoverIds` in `SessionEntity`, ambiguous `date`/`createdAt`/`savedAt` semantics, and remaining `as any` casts in `web/src/store.ts`.

---

## Fixes Applied

### Data Synchronization (P0-P1)

| Issue | Resolution |
|-------|------------|
| **Derived Data Duplication** (`absenceCount`) | Now derived from `AbsenceLedger` (single source of truth). Cached field deprecated. |
| **No Correction Mechanism** | Added `correctMark()` for atomic session+ledger updates. History page has inline correction UI. |
| **Race Condition in pickStudents** | Added `isPickingStudents` guard flag via `canStartOperation()` from `sync.ts`. |
| **No Optimistic Locking (Sheets)** | Added timestamp conflict detection with user warning. |
| **Partial Export Failures** | Made sheet clears sequential with failure markers. |

### Access Pattern Violations (P2)

| Issue | Resolution |
|-------|------------|
| **Direct DB Access (Session/History/Settings)** | Added `getSessions()`, `getClassSettings()`, `updateClassSettings()` store actions so core flows go through `store.ts` (some UI helpers still use `db` directly, e.g. History export and the CSV file picker). |
| **Direct DB Mutation (Roster)** | Roster view reads via store (students + ledger-derived absence counts); roster import is the only place that writes student rows directly. |
| **Mixed Responsibilities** | Extracted pure logic into `attendance.ts`, `sync.ts`, `validation.ts` for testability. |

### Safety Mechanisms (P0-P2)

| Issue | Resolution |
|-------|------------|
| **No Autosave for Drafts** | Added autosave via `localStorage`; draft restored on class selection. |
| **No Error Boundaries** | Added `ErrorBoundary.tsx`, wraps routes in `App.tsx`. |
| **No Import Validation** | Created validation functions in `validation.ts`. Google Sheets import now uses a **validate → commit** flow (fail-closed) and validates Students/Sessions/Marks/Ledger (including referential integrity checks) before any destructive local overwrite. |
| **No Unit Tests** | Added Vitest unit tests for core logic boundaries (attendance + sampling + sync + validation + Sheets identity parsing). |
| **Swallowed Errors** | Added `console.debug()` logging to catch blocks. |

### State Management follow-ups (Feb 2026)

| Issue | Resolution |
|-------|------------|
| **Global loading/error state clobbering** | Replaced a single `isLoading`/`error` flag with per-operation status under `opStatus` in `web/src/store.ts` (e.g., `pickStudents`, `saveSession`, `exportSheets`, `importSheets`, `repairSheets`) so unrelated operations don’t overwrite each other’s UI state. |
| **Low-signal sync debugging** | Added a bounded sync report artifact written to `localStorage['checkpoint_last_sync_report_<classId>']` after Sheets export/import/repair to support reproducible debugging without telemetry. |

---

## Deferred Items (P3)

These remain open as low-priority improvements:

- Replace module-level Google auth state with a class (`google.ts`)
- Remove redundant `carryoverIds` from `SessionEntity`
- Clarify three date fields in `SessionEntity`
- Remove `as any` casts in `store.ts`

---

## Files Added/Modified

| File | Status | Purpose |
|------|--------|---------|
| `attendance.ts` | New | Pure carryover/weight logic |
| `attendance.test.ts` | New | Unit tests for carryovers/eligibility/absence counting |
| `sampling.ts` | New | Weighted sampling without replacement |
| `sampling.test.ts` | New | Unit tests for weighted sampling |
| `sync.ts` | New | Pure sync logic (guards, conflicts) |
| `sync.test.ts` | New | Unit tests for conflict detection + operation guards |
| `validation.ts` | New | Pure import validation functions |
| `validation.test.ts` | New | Unit tests for import validators |
| `ErrorBoundary.tsx` | New | React error boundary |
| `google.ts` | Modified | Google Sheets helpers + identity probing + schema safety |
| `google.test.ts` | New | Unit tests for spreadsheet ID parsing + identity derivation |
| `store.ts` | Modified | Guards, autosave, validation wiring |
| `App.tsx` | Modified | Routes wrapped in ErrorBoundary |
| `types.ts` | Modified | `absenceCount` deprecated, `lastExportedAt` added |

---

## Original Plan Documents

Earlier plan docs referenced by this archive were consolidated into current, long-lived documentation and removed.

Related long-lived docs:
- `docs/product/prd.md`
- `docs/product/design-overview.md`
- `docs/implementation/implementation-plan.md`
- `docs/guidelines/external-sync-safety-guidelines.md`
- `docs/guidelines/web-testing-guidelines.md`
