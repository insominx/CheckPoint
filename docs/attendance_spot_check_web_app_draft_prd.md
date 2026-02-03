# Attendance Spot-Check Web App - Draft PRD (v0.2, implementation-aligned)
## Product: CheckPoint

## 1) Problem & Goal
Teachers need a fast way to spot-check attendance by randomly sampling a small subset of students while ensuring previously absent students are rechecked next session until confirmed present. The app should reduce time spent, avoid omissions, and create a simple record of absences.

Primary Goal: In <= 10 seconds, select N students to check today, prioritizing any students previously marked absent ("carryovers"), then randomly sampling from students who have never been marked absent in the class, and persist absences for future sessions.

Non-Goals (v1): Full SIS integration, seating charts, tardy tracking, parental notifications, per-minute roll tracking, analytics beyond simple counts.

## 2) Users & Context
- Primary user: Instructor (single account) operating on a laptop/phone web browser, possibly on spotty school Wi-Fi.
- Secondary: Teaching assistant (optional shared access; not implemented).

## 3) Definitions
- Class: A course/section with its own roster and history; attendance logic is scoped per class.
- Roster: List of enrolled students for a class with stable identifiers (`studentId` + name).
  - If `studentId` is missing/blank on import, the app generates a UUID and stores it in IndexedDB (it does not modify the original CSV file).
- Present: Explicitly marked present in a session (per class).
- Absent: Explicitly marked absent in a session (per class), with optional reason.
- Carryover (Recheck): Student marked absent in the most recent session and not yet subsequently marked present (derived per class). Must appear in every new session until cleared.
- Eligible for Random: Students who have never been marked absent in this class. No prior Present is required (bootstraps on day one).

## 4) Core User Stories (current implementation)
1. As a teacher, I choose a class (Home page) and manage that class's roster/history.
2. I press Pick Students to generate today's set consisting of:
   - All carryovers (must appear, uncapped), and
   - Plus a random sample of size N (default 5) from eligible students (never-absent) to check today.
3. For each shown student, I mark Present/Absent and optionally set a reason (Excused/Unexcused).
4. Saving finalizes the session to IndexedDB and appends absence entries to the absence ledger (one entry per absent mark).
5. I can configure N and sampling weights per class (Settings page).
6. I can export per-class absences to CSV (History page).
7. I can optionally sync per-class data to Google Sheets and import from Sheets (Settings page; import overwrites local data for that class).

## 5) Selection Algorithm (current implementation)
Let (scoped per class):
- N = requested random size (default 5; per-class setting).
- Carryovers = students currently carryover-flagged without a later Present.
- Eligible = students never marked absent.
- DisplaySet = students shown this session.

Steps at session start:
1. Always include all Carryovers in DisplaySet (no cap).
2. Draw a random sample of size N from Eligible using weighted sampling without replacement:
   - Never-seen boost: if a student has no saved marks in any prior session, they get `neverSeenWeight` (default 2.0); otherwise weight 1.0.
   - Cooldown bias: if a student appears in the pick set for each of the last two saved sessions, their weight is multiplied by `cooldownWeight` (default 0.5).
3. DisplaySet = Carryovers union RandomDraw (may exceed N if there are carryovers).

Notes:
- If Eligible has fewer than N students, draw as many as available (no backfill from ever-absent students).
- All logic is per class; students can be carryovers in one class and not another.

State updates on Save:
- Marking Present records a Present mark for the session; carryover status is derived (an absence is cleared when a later Present mark exists).
- Marking Absent appends an absence entry to the ledger (with optional reason) and keeps the student as carryover until a later Present mark is recorded.

## 6) Data Model (Local-first; sync optional)
The implementation uses IndexedDB via Dexie with entities defined in `web/src/types.ts`:

- `ClassEntity`: `{ id: string, name: string, defaultN: number, csvPath?: string }`
- `StudentEntity`: `{ id: string, classId: string, displayName: string, firstName?, lastName?, loginId?, sisId?, notes? }`
- `SessionEntity`: `{ id: string, classId: string, date: ISODateTime, createdAt?, savedAt?, picks: string[], carryoverIds?: string[], marks: Record<string, { status: 'present'|'absent', reason?, markedAt? }> }`
- `AbsenceLedgerItem`: `{ id: string, classId: string, studentId: string, date: ISODateTime, sessionId?, reason?, notes? }`
- `PerClassSettings`: `{ classId: string, defaultN: number, neverSeenWeight: number, cooldownWeight: number, csvFileHandle?, spreadsheetId?, lastExportedAt? }`

Derived concepts:
- Carryovers are derived from the ledger and the most recent Present marks (not stored as a separate index).
- Absence counts are derived from the ledger (no cached counter is persisted).

## 7) Persistence
- Default: Browser IndexedDB per class (Dexie DB name is `CheckPointDB`).
- Draft sessions: The current (unsaved) session is auto-saved to `localStorage` under `checkpoint_draft_session_<classId>`.
- CSV export (manual): History page exports a full per-class absence ledger to `absences_<classId>.csv` with columns `date,studentId,displayName,status,reason` where `status` is always `ABSENT`.
- CSV output (optional): Settings lets the user select an output CSV file via the File System Access API; on Save, the app attempts to write absent rows for that session to that file.
- Google Sheets sync (optional): Settings can export/import per-class data to a spreadsheet using Google Identity Services and the Sheets/Drive APIs.

## 8) Roster Ingestion (current implementation)
- Per class: CSV import (Roster page).
- CSV must include a header row. Parsed headers (see `web/src/utils/csv.ts`): `studentId,firstName,lastName,displayName,loginId,sisId,className`.
  - Missing columns/values are treated as empty.
  - If `studentId` is missing/blank, the app generates a UUID for that student during import.
  - `className` is currently ignored by import logic; all imported rows are assigned to the currently selected class.
- Extra columns are ignored by the app.

Example roster (provided):
```csv
studentId,firstName,lastName,displayName,loginId,sisId,className
08c8c792-485f-4a0c-91b2-8cf1a02dd640,Krystelle,Barroso,Krystelle Barroso,barr5628,barr5628,CST325-80_2254: Graphics Programming
b78d4133-6b02-4883-af47-1459f3aa7d70,Athena,Burciaga,Athena Burciaga,burc2273,burc2273,CST325-80_2254: Graphics Programming
9450270d-538c-458d-ada0-8002a7382b20,Andrew,Caskey,Andrew Caskey,cask7728,cask7728,CST325-80_2254: Graphics Programming
6aff0c8c-cb91-4d88-a88b-419313ca5756,Michael,Conley,Michael Conley,conl8410,conl8410,CST325-80_2254: Graphics Programming
974649d9-c092-4206-b434-af5b47b9e9d2,Johnathan,Cortez-Bautista,Johnathan Cortez-Bautista,cort9611,cort9611,CST325-80_2254: Graphics Programming
41116623-379a-4b2a-ae40-4a13a3f1ef87,Matthijs,De Vries,Matthijs De Vries,devr5681,devr5681,CST325-80_2254: Graphics Programming
89301c96-1ae5-4586-9d7a-2f696ba46568,Moises,Felix,Moises Felix,feli4319,feli4319,CST325-80_2254: Graphics Programming
7578efe0-811d-4be9-99af-b1c12777a5a6,Jesus,Garcia - Loyola,Jesus Garcia - Loyola,garc1930,garc1930,CST325-80_2254: Graphics Programming
7060e63d-ad60-4da8-abdf-49a2196dfe81,Jorman,Guadarrama,Jorman Guadarrama,guad2454,guad2454,CST325-80_2254: Graphics Programming
14ee5266-5ff8-4fcb-9594-5e08a5aa401e,Elijah,Hart,Elijah Hart,hart4192,hart4192,CST325-80_2254: Graphics Programming
```

## 9) UX Flows (current implementation)
Home:
- Choose Class (dropdown), optionally create a new class, then press Pick Students to start a session.

Session:
- Banner: "Carryovers included automatically (not capped)."
- Controls: progress count, Re-draw button, Save button.
- Save is disabled until all picked students are marked.
- Student cards: name, Present/Absent toggles, reason dropdown (enabled when Absent), carryover highlight.

History:
- Sessions table (expandable for details).
- Export Absences CSV.
- Delete a session (and its ledger entries).
- Clear all history for the current class.
- Correct marks in a past session (updates session + ledger).

Roster:
- Import roster CSV for the current class.
- View roster with derived absence counts (sortable).

Settings:
- Default N and sampling weights (`neverSeenWeight`, `cooldownWeight`).
- Choose CSV Output (File System Access API).
- Google Sheets connect + create spreadsheet + sync/import.

## 10) Edge Cases
- Many carryovers: all appear each session until cleared; random draw is still size N and added on top.
- No eligible students (everyone has been absent at least once): show carryovers only; random draw is empty.
- Student absent repeatedly: remains carryover across sessions until marked present in a later session.
- Student moves classes: no built-in transfer; history does not cross classes.

## 11) Performance & Reliability
- Offline-first PWA. Core attendance actions work without network.
- Writes are atomic via Dexie transactions; the absence ledger is append-only except when correcting past marks.

## 12) Privacy & Compliance
- Store minimal PII (name + local ID). All data stays local unless the user enables sync.
- No third-party analytics in v1.

## 13) Success Metrics (v1)
- Time from open to picks <= 10s (p75).
- >= 95% sessions saved without errors.
- Teachers report fewer missed follow-ups on prior absences.

## 14) Release Plan
- v1.0 (current): Multi-class support; roster import (UUID generation if missing); carryovers uncapped; weighted random with never-seen boost and 2-session cooldown; present/absent with reasons; per-class CSV export; history correction tooling; Google Sheets sync/import.
- v1.1 (next): Filters/search in History; roster export; better session cancellation/re-draw UX; improved offline status UI.

## 15) Open Questions
- None.

## 16) Acceptance Criteria (v1)
- Given a selected class and roster, when I press Pick Students with N=5, the app shows all carryovers (uncapped) plus 5 random eligible students (never marked absent) with weighting (never-seen > others; reduced weight if picked in each of last two saved sessions).
- Marking Absent creates an absence ledger entry with optional `reason` (excused/unexcused). Marking Present clears carryover (via derived carryover logic).
- Saving persists the session (including marks) to IndexedDB.
- Exporting absences produces `absences_<classId>.csv` with `date,studentId,displayName,status,reason` for each absence.
- IDs are generated for students missing IDs and are included in exports so identity is stable across sessions.

## 17) Tech Notes (current)
- App location: `web/` (Vite SPA).
- Stack: React + TypeScript + Vite + React Router.
- State: Zustand store (`web/src/store.ts`).
- Storage: IndexedDB via Dexie (`web/src/db.ts`).
- CSV: Papaparse (Roster import + History export).
- Sampling: Weighted random without replacement using `seedrandom` (`web/src/sampling.ts`); weights configurable per class (Settings).
- Sync: Google Sheets export/import implemented in `web/src/google.ts` (requires `VITE_GOOGLE_CLIENT_ID`).
- Testing: Vitest (no Playwright configured in this repo).
- Build: PWA via `vite-plugin-pwa` (auto-update).

---
Owner: Michael G.
Status: Updated to match current implementation (Feb 3, 2026).
