# CheckPoint — v1 Implementation Plan (Simplified)

## Objectives
- Minimize time to pick: In ≤10s, show all carryovers plus N random eligible students per class.
- Ensure follow‑ups: Keep absent students as carryovers until marked present.
- Persist locally: Offline‑first, append absences to per‑class CSV, keep IDs stable.

## Non‑Goals (v1)
- SIS integration, authentication/roles, seating charts, tardy tracking, advanced analytics.

## Core Deliverables (v1)
- Multi‑class support with roster import (ID generation if missing) and normalized roster export.
- Pick Students: carryovers (uncapped) + weighted random N from never‑absent; re‑draw before save.
- Mark Present/Absent (+ reason), update absence counts and carryovers, save session.
- Per‑class absences CSV export; basic History view and per‑class Settings (N, weight multipliers).
- Offline‑first PWA with reliable local storage.

## Architecture & Tech
- Frontend: React + TypeScript + Vite (SPA), desktop‑first responsive.
- State: Zustand (or Redux Toolkit if preferred patterns).
- Storage: IndexedDB via Dexie; append‑only AbsenceLedger; derived carryovers/counts.
- CSV: Papaparse for import/export; File System Access API with download fallback.
- Testing: Vitest (unit/integration) + Playwright (E2E); deterministic seeding for selection tests.

## Data Model (minimal)
- Class: `{ id, name, csvPath? }`
- Student: `{ id, classId, firstName, lastName, displayName, externalId?, absenceCount }`
- Session: `{ id, classId, date, picks: StudentID[], marks: Record<StudentID, { status: 'present'|'absent', reason? }>} `
- AbsenceLedger: `[{ classId, studentId, date, reason? }]` (append on Absent only)

## Selection Algorithm (per class)
1. Carryovers: all students absent most recently and not yet marked present.
2. Eligible: students never marked absent in this class.
3. Weights: 2.0 if never‑seen (no marks at all), 1.0 otherwise; apply 0.5 cooldown if student was involved in each of the last two sessions.
4. Random draw: weighted, without replacement, size N from Eligible. DisplaySet = Carryovers ∪ RandomDraw.
5. Re‑draw regenerates the random portion only (carryovers fixed) until Save.

## Phased Plan
- Phase 1 — Setup & Data Layer
  - Scaffold Vite + TS + React; PWA manifest and SW.
  - Dexie schema (classes, students, sessions, ledger), repositories, derived selectors (carryovers, involvement).
- Phase 2 — Roster Import & Classes
  - CSV import with flexible column mapping; generate UUIDs when missing.
  - Create/select classes; normalized roster export to CSV with stable IDs.
- Phase 3 — Selection & Core UI
  - Implement weighted sampler with seedable RNG; unit tests.
  - Home + Session screens: N selector, Pick, Re‑draw, Present/Absent (+ reason), absence count badge.
- Phase 4 — Persistence & Export
  - Save session transaction: update counts, carryovers; append AbsenceLedger.
  - Export `absences_<classId>.csv` (`date,studentId,displayName,status,reason`).
- Phase 5 — History, Settings, Offline & Tests
  - History table (filters by date/student), per‑class settings (N, weights), delete‑all/export.
  - Offline polish, basic accessibility, Playwright E2E for acceptance criteria.

## Testing (essentials)
- Unit: eligibility, weights, cooldown, sampling without replacement; ID generation.
- Integration: save flow updates counts/carryovers; re‑draw behavior; CSV export content.
- E2E: carryovers + N random eligible; present clears carryover; absent persists/retains; offline session then export.

## Acceptance Criteria Mapping
- Carryovers + N weighted random eligible; re‑draw replaces randoms only.
- Present clears carryover; Absent appends ledger, increments count, and keeps carryover.
- Persist to IndexedDB and export per‑class absences CSV; IDs remain stable across exports.

## Risks & Mitigations
- CSV variability: column mapper UI; store per‑class import mapping.
- Offline reliability: atomic Dexie transactions; append‑only logs; retry on launch.
- Performance: precompute carryovers/indexes; light UI; stream parse CSV; avoid heavy deps.

