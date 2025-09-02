# Attendance Spot-Check Web App — Draft PRD (v0.1)
# Title - CheckPoint

## 1) Problem & Goal
Teachers need a fast way to spot‑check attendance by randomly sampling a small subset of students while ensuring previously absent students are rechecked next session until confirmed present. The app should reduce time spent, avoid omissions, and create a simple record of absences.

**Primary Goal:** In ≤10 seconds, select N students to check today, prioritizing any students previously marked absent ("carryovers"), then randomly sampling from students with prior confirmed attendance, and persist absences for future sessions.

**Non‑Goals (v1):** Full SIS integration, seating charts, tardy tracking, parental notifications, per‑minute roll tracking, analytics beyond simple counts.

## 2) Users & Context
- **Primary user:** Instructor (single account) operating on a laptop/phone web browser, possibly on spotty school Wi‑Fi.
- **Secondary:** Teaching assistant (optional shared access).

## 3) Definitions
- **Class:** A course/section with its own roster and history; attendance logic is scoped per class.
- **Roster:** List of enrolled students per class with stable identifiers (StudentID + Name). If missing, the app will generate and write IDs back to CSV.
- **Present:** Explicitly marked present in a session (per class).
- **Absent:** Explicitly marked absent in a session (per class), with optional reason.
- **Carryover (Recheck):** Student marked absent in the most recent session and not yet subsequently marked present (per class). Must appear in every new session until cleared.
- **Eligible for Random:** Students **who have never been marked absent** in this class. No prior Present is required. This enables bootstrapping on day one.

## 4) Core User Stories
1. As a teacher, I choose a **class** (from a class dropdown) and load that class’s roster/history.
2. I click **Pick Students** to generate today’s set consisting of:
   - **All carryovers** (must appear, uncapped), and
   - **Plus** a random sample of size **N** from **Eligible for Random** (never‑absent) to check today.
3. For each shown student, I can mark Present/Absent and select an optional absence reason (Excused/Unexcused) and see their running **absence count**.
4. Saving writes the session, appends today’s absences to per‑class CSV, updates carryovers, and increments absence counts.
5. I can configure **N** (default 5) per class.
6. I can view/export per‑class CSV/JSON of absences by date.
7. I can press **Re‑draw** before saving; the prior draw is discarded. **Confirm/Save** locks the sample as one session.

## 5) Selection Algorithm (Deterministic Spec)
Let (scoped per class):
- `N` = requested random size (default 5).
- `Carryovers` = students currently absent‑flagged without a later Present.
- `Eligible` = students **never marked absent**.
- `DisplaySet` = students shown this session.

**Steps at session start:**
1. **Always include all Carryovers** in `DisplaySet` (no cap).
2. Draw a **random sample of size N** from `Eligible` using weighted sampling:
   - **Preference for never‑seen students:** if a student has **no history at all** (no marks), they get a higher weight (e.g., weight 2.0) vs. weight 1.0 for others in `Eligible`.
   - **Cooldown bias:** students sampled or marked **in each of the last two sessions** have their weight reduced (e.g., multiply by 0.5). Still possible to draw them.
   - Uniform without replacement within the draw after weighting.
3. `DisplaySet = Carryovers ∪ RandomDraw` (may exceed N if there are carryovers).
4. Within a session, the set is fixed unless the user clicks **Re‑draw**. Re‑draw regenerates step 2 only (carryovers remain included), then replaces the unsaved `DisplaySet`.

**State updates on Save:**
- Mark **Present** clears carryover for that student.
- Mark **Absent** appends an absence entry (with reason), increments the **absence count**, and keeps them as carryover for next time.

**Notes:**
- If `Eligible` has fewer than N, draw as many as available; do **not** backfill from non‑eligible. The user may still proceed with fewer randoms.
- All logic is per class; students can be carryovers in one class and not another.

## 6) Data Model (Local‑first; sync optional)
**Class** `{ id: string, name: string, csvPath?: string }`

**Student** `{ id: string, classId: string, firstName, lastName, displayName, externalId?, notes?, absenceCount: number }`

**Session** `{ id: string, classId: string, date: ISODate, picks: StudentID[], marks: Record<StudentID, { status: 'present'|'absent', reason?: 'excused'|'unexcused' }] }`

**AbsenceLedger** `[{ classId, studentId, date, reason?: 'excused'|'unexcused', notes? }]`

**CarryoverIndex** `{ classId, studentId -> lastAbsentDate }`

**SamplingState** `{ classId, studentId -> { timesSampled: number, lastSampledDate?: ISODate, lastPresentDate?: ISODate, lastTwoSessionsFlags: [boolean, boolean] } }`

## 7) Persistence
- **Default:** Browser IndexedDB per class + export/import JSON.
- **Per‑class CSV outputs:** `absences_<classId>.csv` with headers `date,studentId,displayName,status,reason` where `status` = `ABSENT` only.
- **CSV ID policy:** If roster CSV rows lack an `studentId` column, the app generates stable UUIDs, **writes them back** to the in‑memory roster, and on **export** includes the generated IDs so future imports preserve identity.
- **No auth; desktop/laptop usage assumed.**

## 8) Roster Ingestion
- Per class: paste, manual add, or CSV import with mappable columns.
- **Accepted roster headers (final):** `studentId,firstName,lastName,displayName,loginId,sisId,className`.
- If `studentId` is missing, generate a stable UUID and include it on future exports so identity persists.
- `className` is used to bind rows to a specific class; history and carryovers do not cross classes.
- Extra columns are ignored by logic but preserved on export when possible.

**Example roster (provided):**
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
07df8731-a401-4154-a052-d15996933b36,Ethan,Huang,Ethan Huang,huan5144,huan5142,CST325-80_2254: Graphics Programming
3ebaec59-90c7-4d5f-aff2-53afc86bd988,Thomas,Kerr,Thomas Kerr,kerr1079,kerr1079,CST325-80_2254: Graphics Programming
ed3464cc-aeae-41e7-86c1-1ba37feacd01,Tony,Lopez Garcia,Tony Lopez Garcia,lope3456,lope3456,CST325-80_2254: Graphics Programming
499391d9-b0dd-4f03-8068-65bfcbe8320a,Emily,Madsen,Emily Madsen,mads6991,mads6991,CST325-80_2254: Graphics Programming
419dfa1d-fc5b-471a-94e1-0236f90b77d9,Steven,Mecklenburg,Steven Mecklenburg,meck6427,meck6427,CST325-80_2254: Graphics Programming
7dda0b26-f2df-4c61-97c9-77611e184370,Austin,Metke,Austin Metke,metk8863,metk8863,CST325-80_2254: Graphics Programming
d360a33b-5bad-48b5-9a93-24c89ae28bbb,Joseph,Molina,Joseph Molina,moli2658,moli2658,CST325-80_2254: Graphics Programming
9e961a2b-42ce-42a4-965a-df3d9ddf0d7f,Gabriel,Myers,Gabriel Myers,myer9696,myer9696,CST325-80_2254: Graphics Programming
4df9d738-6b8d-4e3b-8578-75f3d510ae02,Connor,O'brien-Roedell,Connor O'brien-Roedell,obri7719,obri7719,CST325-80_2254: Graphics Programming
09cccf20-08e5-4659-a491-a04b77d4847e,Daniel,Orta,Daniel Orta,orta2974,orta2974,CST325-80_2254: Graphics Programming
85d379c3-d278-4ff0-be38-15d84b020428,David,Orta,David Orta,orta4570,orta4570,CST325-80_2254: Graphics Programming
39aa0978-4e01-44be-a0e9-f5f1ae65ed44,Silvia,Pineda Jimenez,Silvia Pineda Jimenez,pine9655,pine9655,CST325-80_2254: Graphics Programming
9ee656ed-9b9e-4dd8-a265-fbd4a91cc712,Tyler,Pruitt,Tyler Pruitt,prui2639,prui2639,CST325-80_2254: Graphics Programming
1a59f9d8-b320-45b7-afa8-23d9d6fd4c04,Sanay,Rahul Jog,Sanay Rahul Jog,jog7538,jog7538,CST325-80_2254: Graphics Programming
c6a452c0-5bde-4701-9fa6-2eedb8fab8ac,Chris,Rensel-Smith,Chris Rensel-Smith,rens2250,rens2250,CST325-80_2254: Graphics Programming
498fd475-503e-4278-af18-1d80520e2057,Ryan,Riggs,Ryan Riggs,rigg6200,rigg6200,CST325-80_2254: Graphics Programming
e783d86a-e7d1-4187-9295-ab0c75abdb1a,Keith,Ruxton,Keith Ruxton,ruxt4008,ruxt4008,CST325-80_2254: Graphics Programming
9e69910e-a474-4f7f-8ef3-a1c4e3a582b3,Mohammad,Shahroudi,Mohammad Shahroudi,shah7739,shah7739,CST325-80_2254: Graphics Programming
e3e2e35c-61b0-42b9-b005-ec4e4cf6ea9f,Lucas,Tan,Lucas Tan,tan6407,tan6407,CST325-80_2254: Graphics Programming
d853f3c1-2b1d-4340-9b29-118d862339ce,Alexis,Tornero,Alexis Tornero,torn8730,torn8730,CST325-80_2254: Graphics Programming
```

## 9) UX Flows
**Home:** Choose **Class** (dropdown), then big **Pick Students**, N selector (per class), and **Re‑draw** / **Save** controls.

**Session Screen:**
- Header: Date, Class, N, Re‑draw, Save.
- Student Cards: Name, Present/Absent toggles, Reason (Excused/Unexcused if Absent), Absence Count badge.
- Banner: "Carryovers included automatically (not capped)."
- Toast on save: e.g., "Saved. 2 absences recorded for CST‑101." 

**History (per class):** Table with filters (date range, student), export CSV/JSON.

**Settings (per class):** Default N, weight multipliers (never‑seen boost, cooldown factor), data export/import.

## 10) Edge Cases
- **Many carryovers:** All appear each session until cleared; random draw is still size N and added on top.
- **No eligible students** (everyone has been absent at least once): show carryovers only and a notice; instructor can proceed.
- **Student absent repeatedly:** They remain carryover across sessions until marked present.
- **Student moves classes:** Archive in one class, add to another; history does not cross classes.

## 11) Performance & Reliability
- Offline‑first PWA. All actions work without network.
- Writes are atomic; use append‑only logs then derive indexes.
- Unique session per date per class; allow multiple sessions per day with unique IDs.

## 12) Privacy & Compliance
- Store minimal PII (name + local ID). All data stays local unless user enables sync.
- Provide export + delete‑all controls. No 3rd‑party analytics in v1.

## 13) Success Metrics (v1)
- Time from open to picks ≤ 10s (p75).
- ≥ 95% sessions saved without errors.
- Teachers report fewer missed follow‑ups on prior absences.

## 14) Release Plan
- **v1.0:** Multi‑class support, roster import with ID generation, carryovers uncapped, weighted random with never‑seen boost and 2‑session cooldown, present/absent with reasons, per‑class CSV export, absence counts, re‑draw before save.
- **v1.1:** Optional cloud sync; configurable cooldown window per class; basic reports (per‑student absence timeline).
- **v1.2:** TA sharing (auth), role permissions.

## 15) Open Questions
- (None for v1; N=5 and weight values locked.)

## 16) Acceptance Criteria (v1)
- Given a selected **class** and roster, when I press **Pick Students** with N=5, the app shows **all carryovers** (uncapped) **plus** 5 random students from those **never marked absent** in this class, with weighting (never‑seen > others; reduced weight if sampled in each of last two sessions).
- Marking **Present** removes carryover; marking **Absent** appends an entry with `reason` (Excused/Unexcused), increments absence count, and keeps them as carryover for next time.
- **Re‑draw** before save replaces the random portion while retaining carryovers; **Save** finalizes the session as one sample.
- Saving persists to IndexedDB and appends to `absences_<classId>.csv` with `date,studentId,displayName,status,reason` for each absent student on that date.
- IDs are generated for students missing IDs and are included in subsequent exports so identity is stable across sessions.

## 17) Tech Notes (proposed)
- **Stack:** React + TypeScript + Vite; desktop‑first layout; IndexedDB via Dexie.
- **State:** Zustand or Redux Toolkit.
- **CSV:** Papaparse for import/export; per‑class absence CSV on save; optional roster export with generated IDs.
- **Sampling:** Weighted random without replacement: `neverSeenWeight = 2.0`; `cooldownWeight = 0.5` applied to students involved in **each** of the last two sessions; `N = 5` randoms per session (carryovers uncapped).
- **Testing:** Vitest + Playwright; deterministic seeding for selection tests.
- **Build:** Single‑page app; simple file‑based storage; no auth.

---
**Owner:** Michael G.  
**Status:** Finalized for v1 implementation.

