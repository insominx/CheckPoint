Last Edited: 2026-02-03
Topic: State management risk reduction (authority, async ops, and external import/export)
Inputs:
- Docs: `docs/product/prd.md`, `docs/product/design-overview.md`, `docs/scratch/understand-state-management-remaining-work.md`, `docs/guidelines/external-sync-safety-guidelines.md`, `docs/archive/v1-code-quality-improvements.md`, `docs/implementation/implementation-plan.md`
- Code: `web/src/store.ts`, `web/src/google.ts`, `web/src/validation.ts`, `web/src/sync.ts`, `web/src/pages/Settings.tsx`, `web/src/pages/Roster.tsx`, `web/src/pages/History.tsx`, `web/src/db.ts`, `web/src/types.ts`

### 0) Executive synthesis (dense)
- **What’s happening / why it’s hard / what’s at risk**
  - **Two authorities exist in practice**: “store as orchestrator” (`web/src/store.ts`) vs “pages that directly mutate Dexie” (`web/src/pages/Roster.tsx`, `web/src/pages/Settings.tsx`). This increases invariant bypass risk (“identity before I/O”, scoping, validation).
  - **Async ops share a single `isLoading` + `error`** in the store (`web/src/store.ts`), so unrelated operations can clobber UI state and user messaging (e.g., Sheets import/export vs pick/redraw).
  - **Pick/redraw has an explicit race guard** (`isPickingStudents` + `canStartOperation` in `web/src/sync.ts`), but other operations do not have similarly scoped guards.
  - **Sheets identity is strong, but import integrity is weaker**: identity is probed (`probeCheckpointSpreadsheetIdentity` in `web/src/google.ts`) and legacy/mismatch/multi-class is blocked, yet row-level validation is only applied to Students during import (`validateStudentRow` in `web/src/validation.ts`; import logic in `web/src/store.ts`).
  - **Data model mixes “source of truth” and “derived views”**: ledger is truth (PRD/design) and counts are derived (store + exports). This is good, but it demands consistent derivation boundaries to avoid reintroducing hidden caches.

- **What we know**
  - **Ledger-as-truth is implemented** (PRD/design + `web/src/store.ts` save/correct/delete flows).
  - **Sheets “identity before I/O” is implemented** via Settings tab contract (`CHECKPOINT_SETTINGS_HEADERS`) and `probeCheckpointSpreadsheetIdentity()` (`web/src/google.ts`).
  - **Roster import is fail-closed for cross-class collisions** because students are keyed by global `id` in Dexie (see `web/src/pages/Roster.tsx`; schema in `web/src/db.ts` referenced by `docs/product/prd.md` constraint).
  - **Draft sessions are persisted per class** (`checkpoint_draft_session_<classId>`) by a store subscription (`web/src/store.ts`).

- **Unknowns (explicit)**
  - **Unknown**: Actual user-perceived frequency of “UI feels random” from shared `isLoading` (no telemetry; only anecdotal risk).
  - **Unknown**: How often Sheets imports contain malformed Sessions/Ledger/Marks rows (no on-disk import diagnostics artifact today).
  - **Unknown**: Whether “global uniqueness of `studentId` across classes” is a firm product requirement vs a schema-driven constraint we can safely relax (PRD currently states it as “Important (current storage constraint)”).

---

### 1) Problem definition + scope boundaries
- **Problem statement**
  - We need state management that is **predictable, fail-closed where data loss is possible**, and **resilient to user-editable remotes** (Sheets) without making the UI brittle or over-engineered.

- **In scope**
  - **Authority boundaries**: who can mutate Dexie, under what invariants (`web/src/store.ts` vs page direct `db.*` usage).
  - **Async operation state**: loading/error flags, concurrency, cancellation, UI disabling semantics.
  - **Import/export safety**: validation, schema/version handling, identity probes, conflict warnings.
  - **Draft lifecycle**: localStorage mirroring + correctness under class switching/deletion.

- **Out of scope**
  - New user-facing features (History filters, roster export UI) except where they directly reduce state hazard.
  - E2E testing harness/tooling (though we’ll propose experiments).

- **Glossary (project-specific)**
  - **Authority**: the only component permitted to mutate durable state (Dexie) for a given domain operation.
  - **Scoped**: “per-class” boundary for domain records (PRD); “selected class” is the UI’s scope root (`selectedClassId` in `web/src/store.ts`).
  - **Ledger**: `db.ledger` of `AbsenceLedgerItem` is the source of truth for absences; counts and carryovers are derived (PRD/design).
  - **Identity before I/O**: verify remote scope (`classId`) and schema contract before destructive overwrite/import (`docs/guidelines/external-sync-safety-guidelines.md` + `web/src/google.ts`).

---

### 2) Current state (ground truth)
- **Primary state owners**
  - **UI/orchestration**: Zustand store `useStore` (`web/src/store.ts`).
  - **Durable local**: Dexie `CheckPointDB` tables (`web/src/db.ts`).
  - **Draft persistence**: store autosave subscription → `localStorage` key `checkpoint_draft_session_<classId>` (`web/src/store.ts`).
  - **External (optional)**: Google Sheets I/O via `web/src/google.ts`, orchestrated by store actions (`exportCurrentClassToSheets`, `importCurrentClassFromSheets`, `repairCurrentClassSpreadsheetIdentity` in `web/src/store.ts`).

- **Where the issue surfaces today**
  - **UI clobbering risk**: multiple store actions set `isLoading: true` and clear it in `finally` (`web/src/store.ts`), but there is no per-operation isolation.
  - **Authority drift**: direct `db.*` mutations in:
    - `web/src/pages/Roster.tsx` (import writes students in a transaction)
    - `web/src/pages/Settings.tsx` (writes `csvFileHandle`; reads class for spreadsheet title)
    - `web/src/pages/History.tsx` (reads ledger + students for export; read-only but still bypasses store API)
  - **Import integrity gap**: Sheets import validates students (`validateStudentRow`), but sessions/ledger are mapped with string coercion and no use of `validateSessionRow` / `validateLedgerRow` (`web/src/store.ts`, `web/src/validation.ts`).

- **Prevalence/impact evidence**
  - **Unit tests exist** for core logic boundaries (design overview + test files under `web/src/*.test.ts`), but there is no dedicated “import fuzz” corpus or import summary artifact.

---

### 3) Edge-case taxonomy (must be explicit)
- **Structural vs semantic ambiguity**
  - **EC1 (Structural)**: Sheets tab has duplicated header rows embedded in body, reordered columns, extra columns, or missing columns (`docs/guidelines/external-sync-safety-guidelines.md`).
  - **EC2 (Semantic)**: Sessions rows contain invalid ISO date strings (validator exists: `isValidISODate` in `web/src/validation.ts`) but import path doesn’t enforce it for sessions.
  - **EC3 (Semantic)**: Ledger rows reference unknown `studentId` (missing student row or typo); today import would still bulkAdd ledger entries.

- **Mutation/coupling blast radius**
  - **EC4**: A page-level `db.settings.put(...)` overwrites fields the store expects to control (e.g., `spreadsheetId` uniqueness constraints in `updateClassSettings`).
  - **EC5**: Concurrent operations (Pick Students + Sheets export/import) cause user-visible disabling or incorrect “busy” state due to shared `isLoading`.
  - **EC6**: Draft session autosave continues after class deletion or class switch, producing stale drafts or “phantom” restores if keying/invariants drift.

- **Tool/library behavior pitfalls**
  - **EC7**: Dexie transaction scope doesn’t include all touched tables → partial writes (today store uses multi-table transactions for save/correct/delete/import; roster import uses a transaction for students only).
  - **EC8**: File System Access API writes overwrite rather than append (implementation plan notes current CSV file output is not robust append-with-header).
  - **EC9**: Google module-scoped token state (`web/src/google.ts`) leaks between tests/flows and is harder to reset deterministically.

- **“Opens but weird” vs “won’t open / needs repair” regimes**
  - **EC10 (“Opens but weird”)**: Sheet identity matches, but schema drift exists in non-Settings tabs (Sessions/Ledger headers changed); import proceeds and produces odd local state.
  - **EC11 (“Needs repair”)**: Legacy sheet missing identity metadata (`identity.isLegacy === true`) must be repaired via export/repair workflow (`web/src/store.ts` blocks import).
  - **EC12 (“Won’t open”)**: Multi-class sheet detected (`identity.multipleClassIds`) blocks destructive ops by design.

---

### 4) Solution space (the corpus)
Below, “MVP” means “safely reduces hazard now without large refactors”. “Later” means “meaningful architectural shift”.

#### Option 1 — Split async status into per-operation flags (minimal store refactor)
- **Idea**: Replace global `isLoading`/`error` with a map keyed by operation (`pick`, `save`, `exportSheets`, `importSheets`, `repairSheets`, `deleteClass`, etc.).
- **What it changes (and where)**: `web/src/store.ts` (`UIState` + all actions that `set({ isLoading... })`).
- **Pros**
  - Reduces UI clobbering + “random busy state” risk immediately.
  - Enables granular UI disablement and clearer error surfacing.
- **Cons**
  - Requires touching many call sites and UI components that read `isLoading`.
- **Failure modes / risks**
  - Inconsistent UI if some components still rely on the old single flag.
- **Phase fit**: **MVP**

#### Option 2 — Introduce an in-store operation mutex/queue with typed “operation tokens”
- **Idea**: Generalize `isPickingStudents` + `canStartOperation` into a small op-runner: `runOp(name, fn)` that enforces (a) one op at a time or (b) a safe concurrency policy.
- **What it changes (and where)**: `web/src/store.ts` + `web/src/sync.ts` (extend guard semantics).
- **Pros**
  - Makes concurrency policy explicit and testable (unit tests similar to `sync.test.ts`).
  - Avoids ad-hoc per-action guards.
- **Cons**
  - Might feel overkill if UI already serializes ops naturally.
- **Failure modes / risks**
  - Deadlocks if token release is not `finally`-safe.
- **Phase fit**: **MVP**

#### Option 3 — Fail-closed, row-level validation for Sessions/Ledger/Marks during Sheets import
- **Idea**: Apply `validateSessionRow` and `validateLedgerRow` (already exist in `web/src/validation.ts`) and add explicit validation for Marks rows.
- **What it changes (and where)**: `web/src/store.ts` `importCurrentClassFromSheets()`; possibly `web/src/validation.ts` (add `validateMarkRow`).
- **Pros**
  - Converts “import silently creates weird local state” into “import blocks with actionable message”.
  - Aligns with external sync safety doc (“fail closed by default”).
- **Cons**
  - Some real-world sheets with minor imperfections would become non-importable until repaired.
- **Failure modes / risks**
  - Overly strict validation could block legitimate older exports unless a migration path exists.
- **Phase fit**: **MVP**

#### Option 4 — Staged import: validate → summarize → commit (two-phase destructive overwrite)
- **Idea**: Read + validate into memory; compute a summary (counts, skipped rows, first N errors). Only then perform the destructive local overwrite transaction.
- **What it changes (and where)**: `web/src/store.ts` import flow; add a small “import report” model.
- **Pros**
  - Prevents “we deleted local data, then discovered remote was bad”.
  - Makes import explainable (“here’s what will change”).
- **Cons**
  - More code + more memory usage for large rosters.
- **Failure modes / risks**
  - “Time-of-check/time-of-use”: sheet could change between validate and commit (usually acceptable in single-user flow; can mitigate by re-reading identity timestamp).
- **Phase fit**: **MVP → Later** (depending on UX)

#### Option 5 — Add a lightweight on-disk JSON “sync diagnostic artifact” for import/export
- **Idea**: For every Sheets import/export, write a structured JSON report to `localStorage` (or downloadable blob) with identity probe result, schemaVersion, row counts, validation skips, and errors.
- **What it changes (and where)**: `web/src/store.ts` import/export actions; possibly a small helper module.
- **Pros**
  - Turns Unknowns into measurable evidence without adding telemetry.
  - Makes bug reports actionable (“paste this JSON”).
- **Cons**
  - Needs careful redaction policy (PII minimization) and size caps.
- **Failure modes / risks**
  - Report itself could become stale/confusing if not versioned.
- **Phase fit**: **MVP**

#### Option 6 — Eliminate page-level `db.*` writes by adding store actions (strict authority)
- **Idea**: Route roster import and settings file-handle persistence through the store, so all writes pass invariant checks and share op state.
- **What it changes (and where)**:
  - `web/src/pages/Roster.tsx` → new `store.importRosterCsv(...)`
  - `web/src/pages/Settings.tsx` → new `store.setCsvFileHandle(...)` and `store.createSpreadsheetForClass(...)`
- **Pros**
  - Fewer invariant bypasses; simpler mental model (“store is the only writer”).
  - Enables consistent error/flag semantics.
- **Cons**
  - Refactor cost; risk of regressions in UI flows.
- **Failure modes / risks**
  - Store becomes “god object” if not carefully modularized.
- **Phase fit**: **MVP** (incremental)

#### Option 7 — Keep documented “authority exceptions” but formalize them (contract + linting)
- **Idea**: Accept that some operations will be page-level (e.g., file picker handles), but codify allowed exceptions and wrap them in narrowly-scoped helper functions.
- **What it changes (and where)**: docs + small code wrappers; add comments near `db.*` usage in pages.
- **Pros**
  - Lower refactor cost; keeps store slimmer.
  - Still reduces drift by making exceptions explicit and reviewable.
- **Cons**
  - Requires discipline; exceptions tend to spread.
- **Failure modes / risks**
  - “Exception creep” over time.
- **Phase fit**: **MVP**

#### Option 8 — Import-time referential integrity checks (student/session existence)
- **Idea**: During Sheets import, require:
  - Every ledger row `studentId` exists in imported students.
  - Every marks row `studentId` exists.
  - Every marks row `sessionId` exists, and/or sessions are created first.
- **What it changes (and where)**: `web/src/store.ts` import logic; add checks before `bulkAdd`.
- **Pros**
  - Prevents nonsensical carryover/count behavior caused by dangling IDs.
- **Cons**
  - Requires decisions: drop invalid rows vs block entire import.
- **Failure modes / risks**
  - Blocking on a single bad row may frustrate users; needs good error reporting.
- **Phase fit**: **MVP**

#### Option 9 — Expand schema/version enforcement beyond Settings (tab header + version)
- **Idea**: Treat each sheet tab as a contract: verify headers match expected sets (or can be indexed by header name) before parsing bodies. Include a global “schemaVersion” in Settings and block unsupported versions.
- **What it changes (and where)**: `web/src/google.ts` (add `ensureTabHeaders` / `readTabWithHeaderIndex` utilities); store import/export.
- **Pros**
  - Reduces “opens but weird” (EC10) by making drift explicit.
  - Aligns with external sync safety guidelines.
- **Cons**
  - Can break imports from older sheets unless migration/repair exists.
- **Failure modes / risks**
  - Strict header matching is brittle; prefer header-indexed parsing.
- **Phase fit**: **MVP → Later**

#### Option 10 — Model `SessionEntity` timestamps explicitly (reduce semantic ambiguity)
- **Idea**: Clarify `date` vs `createdAt` vs `savedAt` semantics and enforce them consistently in save/import/export paths.
- **What it changes (and where)**: `web/src/types.ts`, `web/src/store.ts`, Sheets schemas (Sessions tab).
- **Pros**
  - Removes subtle ordering bugs (e.g., sorting sessions by one timestamp, computing carryovers by another).
- **Cons**
  - Schema change (Sheets + local) requires migration story.
- **Failure modes / risks**
  - Migrating old data incorrectly can break carryover derivation.
- **Phase fit**: **Later**

#### Option 11 — Remove redundant `carryoverIds` from `SessionEntity` (or enforce it as derived-only)
- **Idea**: Either stop persisting `carryoverIds` (derive when needed), or make it a strict snapshot with well-defined semantics and validation.
- **What it changes (and where)**: `web/src/types.ts`, store build/save/import/export.
- **Pros**
  - Reduces “two sources of truth” risk inside session objects.
- **Cons**
  - Could reduce debugging convenience (a saved snapshot can be useful).
- **Failure modes / risks**
  - Derivation logic must remain stable across versions.
- **Phase fit**: **Later**

#### Option 12 — Relax “global uniqueness of studentId across classes” via compound keys
- **Idea**: Change Dexie schema so students are keyed by `(classId, id)` (or introduce a separate internal PK), allowing the same `studentId` string in multiple classes.
- **What it changes (and where)**: `web/src/db.ts` schema + all student queries; roster import collision logic; possibly PRD constraint.
- **Pros**
  - Removes cross-class collision footgun and import blocking.
- **Cons**
  - Big migration + lots of code touch; could silently break exports if external tooling assumes global IDs.
- **Failure modes / risks**
  - Hard migration errors; identity semantics must remain stable for exports/sync.
- **Phase fit**: **Later**

#### Option 13 — Encapsulate Google auth state (replace module-level globals)
- **Idea**: Replace `accessToken`/`grantedScopes` globals in `web/src/google.ts` with a small class or injected token provider.
- **What it changes (and where)**: `web/src/google.ts` + tests + store calls.
- **Pros**
  - Better testability and isolation; clearer lifecycle.
- **Cons**
  - Refactor risk; doesn’t directly fix import validation.
- **Failure modes / risks**
  - Token caching regressions; additional OAuth prompts if done wrong.
- **Phase fit**: **Later** (P3 item per archive)

#### Option 14 — “Warnings vs failures” channel + user-facing sync policy table
- **Idea**: Separate transient environmental warnings (OAuth popup policies) from domain failures (identity mismatch, schema unsupported). Build a small policy mapping that drives both UI messages and allowed actions.
- **What it changes (and where)**: store error handling, Settings UI copy; align with `docs/guidelines/external-sync-safety-guidelines.md`.
- **Pros**
  - Reduces user confusion; fewer “false alarms”.
  - Makes risky actions explicit (“Import (overwrite)”).
- **Cons**
  - Mostly UX work; still needs enforcement in code.
- **Failure modes / risks**
  - If policy table diverges from code checks, confusion increases.
- **Phase fit**: **MVP**

#### Option 15 — Add idempotency/deduping guards for imported entities
- **Idea**: Before `bulkAdd`, detect duplicates by `id` and either de-dupe or block with a clear error.
- **What it changes (and where)**: store import path; possibly add helper for detecting duplicates.
- **Pros**
  - Prevents Dexie errors or inconsistent behavior from duplicated IDs in remote.
- **Cons**
  - Needs a decision: last-wins vs first-wins vs fail-closed.
- **Failure modes / risks**
  - “Last wins” can hide data loss; “fail closed” may be too strict without repair tooling.
- **Phase fit**: **MVP**

---

### 5) Trade-off matrix (forced clarity)
Top candidates (pragmatic risk reducers) compared:

| Option | Complexity | Semantics risk | Determinism risk | Blast radius risk | MVP compatibility | Debuggability | Testability |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1) Per-op async flags | Low | Low | Low | Low | High | High | Medium |
| 3) Validate sessions/ledger/marks (fail-closed) | Low-Med | Low | Low | Low-Med | High | High | High |
| 4) Staged import | Med | Low | Low-Med | Low | Med | High | Med-High |
| 6) Store-only writer authority | Med | Low | Low | Med | Med | Med-High | Med |
| 9) Tab header/schema enforcement | Med | Med | Low | Med | Med | High | High |
| 12) Compound key students | High | High | Low | High | Low | Med | Low-Med |

---

### 6) Diagnostics & evidence plan (make it falsifiable)
- **Fast probe (cheap, high-signal)**
  - Add an **import/export report** emitted on every Sheets operation:
    - identity probe result (`classId`, `isLegacy`, `multipleClassIds`, `schemaVersion`, `lastExportedAt`)
    - header presence (per tab)
    - row counts read/written
    - validation: counts of valid/invalid per entity type + first 5 errors
  - Store as:
    - `localStorage['checkpoint_last_sync_report_<classId>'] = JSON.stringify(report)` (bounded), and/or
    - downloadable JSON from Settings after operation.

- **Deep probe (more work, more certainty)**
  - Build a small “import fuzz harness” (unit-test-level) that feeds randomized, adversarial row shapes into:
    - `deriveCheckpointSpreadsheetIdentity` (`web/src/google.ts`)
    - `validateStudentRow` / `validateSessionRow` / `validateLedgerRow` (`web/src/validation.ts`)
  - Goal: prove which edge cases are safely blocked vs silently accepted.

- **Proposed JSON artifact schema**
  - `SyncReportV1` (versioned):
    - `version: '1'`
    - `op: 'export' | 'import' | 'repair'`
    - `classId`, `spreadsheetId`
    - `identity: SpreadsheetIdentityProbe`
    - `tabs: Record<string, { headerOk?: boolean; rowsRead?: number; rowsWritten?: number }>`
    - `validation: { students?: { total; valid; invalid; sampleErrors: string[] }, sessions?: ..., ledger?: ..., marks?: ... }`
    - `startedAt`, `finishedAt`, `elapsedMs`
    - `result: 'ok' | 'blocked' | 'failed'` + `errorMessage?`

---

### 7) Hazard scoring + policy mapping
Define hazard classes (conditions) and map to outcomes (warn/fail/mitigate).

- **Hazard classes**
  - **H0 Safe**: identity matches selected class; schemaVersion supported; headers parseable; validations pass.
  - **H1 Legacy**: identity missing (`identity.isLegacy === true`) but sheet is otherwise parseable.
  - **H2 Mismatch**: identity exists and differs from selected class (`identity.classId !== selectedClassId`).
  - **H3 Multi-scope**: multiple class IDs detected (`identity.multipleClassIds`).
  - **H4 Schema drift**: headers missing/reordered such that required columns can’t be located reliably.
  - **H5 Invalid rows**: validators reject rows; referential integrity breaks (dangling IDs).
  - **H6 Conflict**: remote `lastExportedAt` newer than local timestamp (`shouldWarnAboutConflict` in `web/src/sync.ts`).

- **Policy mapping**
  - **H0**: allow export/import.
  - **H1**: allow **export** if it repairs metadata; block import until repaired (matches current store behavior).
  - **H2**: block all destructive ops; show both identities.
  - **H3**: block; provide “how to fix” guidance (single-class-per-sheet constraint).
  - **H4**: block import; allow repair only if it can re-write headers safely.
  - **H5**:
    - MVP policy: **block import** and show summary; optionally offer “best-effort import” as an explicit override later.
  - **H6**: warn + require confirmation (current export behavior).

- **Which mitigations reduce hazard vs re-label it**
  - Per-op flags (Option 1) reduces UI hazard but does not reduce data hazard.
  - Validation + staged import (Options 3–4) **reduces true data hazard** by preventing destructive overwrites on bad inputs.

---

### 8) Minimal experiments to choose direction
- **Experiment A — “Per-op flags” UX sanity check**
  - **Setup**: Implement Option 1 locally; run through pick/redraw while triggering Sheets export/import.
  - **Expected signal**: UI disables only relevant buttons; no unrelated spinners/errors.
  - **Decision enabled**: whether we need full mutex/queue (Option 2) or flags suffice.
  - **Falsifier**: still see clobbering due to components reading a shared flag.

- **Experiment B — Import validation enforcement**
  - **Setup**: Modify import to validate sessions/ledger/marks; create a “bad sheet” fixture with invalid dates/dangling studentIds.
  - **Expected signal**: import blocks with actionable message; no local data deletion occurs.
  - **Decision enabled**: fail-closed strictness level; whether staged import is needed.
  - **Falsifier**: too many real sheets become non-importable without a clear repair path.

- **Experiment C — Staged import performance**
  - **Setup**: Simulate a roster of 300–800 students and 30 sessions; time validate+commit.
  - **Expected signal**: acceptable latency on typical devices; memory remains stable.
  - **Decision enabled**: whether to ship staged import (Option 4) in MVP.
  - **Falsifier**: large rosters cause long hangs or memory issues.

- **Experiment D — Authority refactor safety**
  - **Setup**: Move roster import writes into the store (Option 6) while keeping UI unchanged.
  - **Expected signal**: no regressions; errors presented consistently.
  - **Decision enabled**: whether to continue “store-only writer” migration or keep exceptions (Option 7).
  - **Falsifier**: store changes become too entangled or hard to test.

---

### 9) “MVP honest” framing (no overcommitment)
- **What we can do now (high safety ROI, low risk)**
  - Option 1 (per-op flags) to stop UI clobbering.
  - Option 3 + 8 (fail-closed validation + referential integrity) to protect destructive import.
  - Option 5 (sync diagnostic artifact) to turn Unknowns into evidence.

- **What needs more evidence / later sequencing**
  - Option 4 (staged import) if we see meaningful invalid-row prevalence or “partial read” hazards.
  - Option 6 vs 7 (strict authority vs documented exceptions) based on how often new features want page-level `db.*`.
  - Option 12 (compound keys / relax global student ID uniqueness) only if product requirements change and we can justify a migration.
