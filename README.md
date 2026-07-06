# CheckPoint

<p align="center">
  <img src="logo.png" alt="CheckPoint Logo" width="120" />
</p>

**CheckPoint** is a fast, offline-first attendance spot-check app for teachers. Instead of calling roll for an entire class, randomly sample a few students each session while ensuring previously absent students are automatically rechecked.

## Features

- **Quick Picks** — Select N random students in seconds
- **Smart Carryovers** — Absent students reappear until marked present
- **Multi-Class** — Manage multiple classes with separate rosters and history
- **Offline-First** — Works entirely in the browser with no internet required
- **CSV Import/Export** — Import rosters, export absence records
- **Google Sheets Backup** — Explicit export/import to a spreadsheet; the app is always the source of truth

## Getting Started

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. **Create a class** on the Overview page
2. **Import a roster** via CSV on the Roster page
3. Click **Start attendance check** to draw students
4. **Mark** each student as Present or Absent
5. **Save** to record the session

Absent students automatically carry over to the next session (shown with a *recheck* badge) until confirmed present.

### Google Sheets

Data lives locally in the browser. On the Settings page you can:

- **Export to sheet** — overwrites the linked spreadsheet with the class's current data (creates one if none is linked)
- **Import from sheet** — validates the sheet and, after confirmation, overwrites the class's local data

Nothing syncs automatically; both directions are explicit and destructive on the receiving side. Requires a `VITE_GOOGLE_CLIENT_ID` env var for OAuth.

## Architecture

```
web/src/
├── domain/       Pure logic: sampling, carryovers, draft building, import validation (unit-tested)
├── data/         Dexie (IndexedDB) schema + repository — the only module that touches the DB
├── services/     Google Sheets client + export/import operations
├── store.ts      Thin Zustand store: selection, session lifecycle, sync orchestration
├── components/   App shell, confirm dialog, toasts
└── pages/        Overview, Session, Roster, History, Settings
```

Rules of the road: pages never touch Dexie directly (they go through the repository or store), and nothing below the page layer opens dialogs — store/service actions return typed results.

## Testing

```bash
cd web
npm run test:run   # unit tests (vitest) for the domain layer
npm run e2e        # Playwright end-to-end test of the core attendance loop
```

## Tech Stack

- React 19 + TypeScript + Vite (PWA)
- Zustand (UI state)
- Dexie (IndexedDB)
- Papaparse (CSV)
- Vitest + Playwright

## Documentation

See [docs/INDEX.md](docs/INDEX.md) for the documentation library, including the PRD and the July 2026 revamp notes.

## License

[MIT](LICENSE.md)
