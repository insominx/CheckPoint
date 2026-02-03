# CheckPoint — High-Level Design Overview

## What is CheckPoint?

**CheckPoint** is a lightweight, offline-first web application for teachers to perform quick attendance spot-checks. Rather than calling roll for an entire class, instructors randomly sample a small subset of students each session while ensuring that previously absent students are automatically rechecked until confirmed present.

---

## Goals

| Goal | Description |
|------|-------------|
| **Speed** | Complete student selection in ≤10 seconds from app launch |
| **Reliability** | Ensure absent students are never forgotten—they carry over until present |
| **Simplicity** | No accounts, no cloud required—runs entirely in the browser |
| **Persistence** | All data persists locally; exportable to CSV for record-keeping |

---

## Core Features

### 1. Multi-Class Support
- Create and switch between multiple classes
- Each class maintains its own roster, history, and settings
- Attendance logic is scoped per class (carryovers do not cross classes)
- Delete a class (Home page) with a local cascade delete of per-class data (students, sessions, ledger, settings, and any draft session in `localStorage`)

### 2. Smart Student Selection
- **Carryovers**: Students with an unresolved absence (most recent absence is more recent than their most recent Present mark, or never marked Present after an absence) automatically appear until cleared
- **Random Sampling**: Weighted random selection of N students from those never marked absent
- **Weighting Logic**:
  - Never-seen students get higher priority (weight 2.0)
  - Students sampled in the last two sessions get reduced weight (0.5 cooldown)

### 3. Session Workflow
1. Select a class and click **Pick Students**
2. Review the displayed students (carryovers + random picks)
3. Mark each student as **Present** or **Absent** (with excused/unexcused reason)
4. **Re-draw** regenerates the random portion (carryovers stay). If you have already marked any students, the app will confirm and **clear marks** before regenerating picks.
5. **Save** finalizes the session and updates all records

### 4. Attendance Tracking
- Absence counts tracked per student
- Absence ledger records every absence with date, reason, and student ID
- Present marks clear carryover status

### 5. Data Import/Export
- CSV roster import with header-based fields (missing columns/values are treated as empty)
- Auto-generates stable UUIDs for students missing IDs
- Per-class absence CSV export for external record-keeping
- Optional Google Sheets integration for cloud backup

---

## Application Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Navigation Bar                                              │
│  [Home] [Session] [History] [Settings] [Roster]             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│                      Main Content Area                       │
│                                                              │
│   Content varies by page (see below)                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Pages

| Page | Purpose |
|------|---------|
| **Home** | Class selection, create new class, launch "Pick Students" |
| **Session** | Active attendance check—display student cards, mark present/absent, save |
| **History** | View past sessions, export absences CSV, delete sessions, correct past marks |
| **Settings** | Configure N (sample size), weight multipliers, CSV output file, Google Sheets sync |
| **Roster** | View roster with derived absence counts (sortable), import CSV |

---

## Data Model

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Class     │──1:N─│   Student   │──1:N─│ AbsenceLedger│
│  id, name   │      │ id, classId │      │ studentId    │
│  defaultN   │      │ displayName │      │ date, reason │
└─────────────┘      └─────────────┘      └─────────────┘
       │                   │
      1:1                 1:N
       ▼                   ▼
┌─────────────────┐  ┌─────────────┐
│PerClassSettings │  │   Session   │
│ defaultN        │  │  id, date   │
│ neverSeenWeight │  │ picks, marks│
│ cooldownWeight  │  │ carryoverIds│
└─────────────────┘  └─────────────┘
```

> **Note**: Absence counts are derived from the ledger, not stored. Carryovers are derived from the ledger + most recent Present marks.

### Key Entities

- **Class**: A course with its own roster and history
- **Student**: Enrolled student with display name and optional metadata (firstName, lastName, loginId, sisId)
- **Session**: A single attendance check event with picks, marks, and timestamps
- **AbsenceLedger**: Append-only log of all absences — **single source of truth**
- **PerClassSettings**: Per-class configuration (N, neverSeenWeight, cooldownWeight, CSV file handle, Google Sheets ID)

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19 + TypeScript |
| **Build** | Vite 7 with PWA plugin |
| **State** | Zustand |
| **Storage** | IndexedDB via Dexie |
| **CSV** | Papaparse |
| **Routing** | React Router v7 |
| **Styling** | Vanilla CSS with dark theme |

---

## Design Principles

1. **Offline-First**: Entire app works without internet; all data in browser IndexedDB
2. **Local-Only by Default**: No authentication, no server—privacy preserved
3. **Testable Selection**: Weighted random uses a seedable RNG (the app does not set a fixed seed in normal usage)
4. **Append-Only Ledger**: Absences logged immutably for reliable history
5. **Desktop-First, Mobile-Friendly**: Optimized for laptop use, responsive design
6. **Ledger as Single Source of Truth**: Absence counts derived from ledger, not cached

---

## Testing

| Type | Tool | Location |
|------|------|----------|
| Unit | Vitest | `web/src/*.test.ts` |

Run: `cd web && npm test`

**Tested modules:**
- `attendance.ts` — Carryover computation, weight calculation
- `sync.ts` — Conflict detection, operation guards
- `validation.ts` — Input validation for entities

---

## Visual Design

- **Dark Theme**: Deep blue-black background with gradient accents
- **Card-Based UI**: Student cards with clear present/absent toggle buttons
- **Visual Indicators**:
  - Yellow/amber border for carryover students
  - Green background for "Present" selection
  - Red background for "Absent" selection
- **Glassmorphic Navigation**: Semi-transparent sticky nav bar with blur effect

---

## User Flow Diagram

```mermaid
flowchart TD
    A[Open App] --> B[Select Class]
    B --> C[Click 'Pick Students']
    C --> D[View Student Cards]
    D --> E{Mark Each Student}
    E -->|Present| F[Clear Carryover]
    E -->|Absent| G[Add to Ledger + Keep Carryover]
    F --> H{All Marked?}
    G --> H
    H -->|No| E
    H -->|Yes| I[Save Session]
    I --> J[Return to Home]
    
    D --> K[Re-draw?]
    K --> D
```

---

## Non-Goals (v1)

The following are explicitly out of scope for the initial version:

- SIS (Student Information System) integration
- Seating charts
- Tardy/late tracking
- Parental notifications
- Advanced analytics
- Multi-user authentication

---

## Future Considerations (v1.1)

- Filters/search in History page
- Roster export
- Better session cancellation/re-draw UX
- Improved offline status UI
