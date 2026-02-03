# CheckPoint - v1 Implementation Plan (Simplified) + Status (Feb 3, 2026)

This document started as a v1 plan. It has been updated to reflect what is implemented in the current codebase under `web/`.

## Status Summary
Implemented core v1. Remaining gaps are mostly UX polish and a few planned features:
- Not implemented: delete class; normalized roster export; flexible column mapping UI; History filters/search; Playwright E2E.
- Partially implemented: per-class CSV output "append" behavior (optional file handle exists, but current write behavior is not a true append and does not write headers).
- Partially implemented: Session UI "absence count badge" (Roster shows derived counts; Session view does not currently display counts).

## Objectives
- Minimize time to pick: in <= 10s, show all carryovers plus N random eligible students per class. (Implemented)
- Ensure follow-ups: keep absent students as carryovers until marked present in a later session. (Implemented; carryovers are derived)
- Persist locally: offline-first storage in browser IndexedDB; export absences to CSV. (Implemented; export is manual via History)

## Non-Goals (v1)
- SIS integration, authentication/roles, seating charts, tardy tracking, advanced analytics.

## Core Deliverables (v1)
- Multi-class support with roster import (ID generation if missing). (Implemented)
- Pick Students: carryovers (uncapped) + weighted random N from never-absent; re-draw before save. (Implemented)
- Mark Present/Absent (+ reason), save session; absence counts are derived from the ledger. (Implemented)
- Per-class absences CSV export; basic History view and per-class Settings (N, weight multipliers). (Implemented)
- Offline-first PWA with reliable local storage. (Implemented via Vite PWA plugin)
- Normalized roster export to CSV with stable IDs. (Not implemented)

## Architecture & Tech (implemented)
- Frontend: React + TypeScript + Vite (SPA) in `web/`.
- Routing: React Router.
- State: Zustand store in `web/src/store.ts`.
- Storage: IndexedDB via Dexie in `web/src/db.ts`.
- Sampling: weighted sampling without replacement in `web/src/sampling.ts` (uses `seedrandom`; store currently uses unseeded randomness).
- CSV:
  - Roster import: Papaparse in `web/src/utils/csv.ts`.
  - Absence export: CSV download in `web/src/utils/csv.ts` (triggered from History page).
  - Optional CSV file output: File System Access API selection in `web/src/pages/Settings.tsx`; session save attempts to write absent rows to the selected file.
- Optional sync: Google Sheets export/import in `web/src/google.ts` (requires `VITE_GOOGLE_CLIENT_ID`).
- Testing: Vitest unit tests exist; Playwright is not configured as a runnable E2E suite in this repo.

## Data Model (current)
Entity types are defined in `web/src/types.ts`:
- Class: `{ id, name, defaultN, csvPath? }`
- Student: `{ id, classId, displayName, firstName?, lastName?, loginId?, sisId?, notes? }`
- Session: `{ id, classId, date, createdAt?, savedAt?, picks: string[], carryoverIds?: string[], marks: Record<string, Mark> }`
- Ledger: `{ id, classId, studentId, date, sessionId?, reason?, notes? }` (one entry per Absent mark)
- Settings: `{ classId, defaultN, neverSeenWeight, cooldownWeight, csvFileHandle?, spreadsheetId?, lastExportedAt? }`

Derived behavior:
- Carryovers are derived from (ledger + the most recent Present marks).
- Absence count is derived from ledger (no cached counter stored).

## Selection Algorithm (per class, implemented)
1. Carryovers: students with an absence more recent than their most recent present mark.
2. Eligible: students never marked absent in this class (ever-absent students are excluded from random selection).
3. Weights:
   - Never-seen boost: if a student has no marks in any saved session, weight = `neverSeenWeight` (default 2.0); otherwise 1.0.
   - Cooldown: if a student appears in the pick set for each of the last two saved sessions, weight *= `cooldownWeight` (default 0.5).
4. Random draw: weighted, without replacement, size N from Eligible. DisplaySet = Carryovers union RandomDraw.
5. Re-draw regenerates the random portion (by regenerating the session) until Save.

## Phased Plan (what’s done vs. pending)
- Phase 1 - Setup & Data Layer (Done)
  - Vite + TS + React; PWA manifest generated via `vite-plugin-pwa`.
  - Dexie schema for classes, students, sessions, ledger, settings.
- Phase 2 - Roster Import & Classes (Partial)
  - CSV import; generate UUIDs when missing.
  - Create/select classes.
  - Pending: "normalized roster export" and "flexible column mapping" UI.
- Phase 3 - Selection & Core UI (Partial)
  - Weighted sampler and unit tests for core attendance logic.
  - Home + Session screens with Pick, Re-draw, Present/Absent, reason.
  - Pending: Session UI absence-count badge (currently not displayed).
- Phase 4 - Persistence & Export (Partial)
  - Save session transaction: persists session + appends ledger entries for absences.
  - Export `absences_<classId>.csv` (`date,studentId,displayName,status,reason`) via History download.
  - Partial: optional CSV file output is implemented, but current behavior is not a robust append-with-header CSV writer.
- Phase 5 - History, Settings, Offline & Tests (Partial)
  - History table (expand session, delete session, clear history, correct marks).
  - Settings (N, weights) + optional CSV output selection + Google Sheets sync/import.
  - Pending: History filters (date/student); E2E suite.

## Testing (current)
- Unit: carryovers, eligibility/weights, cooldown logic; sync/conflict helpers; import validation.
- Integration: basic behaviors are covered indirectly; no dedicated UI/integration harness.
- E2E: not implemented (no Playwright test suite wired up).

## Acceptance Criteria Mapping (current)
- Carryovers + N weighted random eligible; re-draw replaces randoms (by regenerating session) before Save. (Implemented)
- Present clears carryover; Absent appends ledger entry and keeps carryover until later Present. (Implemented; counts derived from ledger)
- Persist to IndexedDB and export per-class absences CSV. (Implemented via History export; optional CSV file output is separate)
- IDs generated for missing student IDs on import are stable in IndexedDB. (Implemented)

## Risks & Mitigations (updated)
- CSV variability: add a column-mapper UI and store per-class mapping. (Pending)
- Offline reliability: Dexie transactions used for save/import/export paths. (Implemented)
- Performance: keep sampling and derived computations light; add memoization/indexing if rosters grow large. (Ongoing)

