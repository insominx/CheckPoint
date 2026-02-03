Last Edited: 2026-02-03

## 1) Contract

- **Behavior**
  - **Settings clearly indicates the active class** (name + id) so users can’t accidentally operate on the wrong class context (`selectedClassId`).
  - **Every Google Sheets “Open / Export / Import” action is gated by a class-identity check**: the spreadsheet must declare which `classId` it is for, and it must match the currently selected class.
  - **Export writes identity metadata into the spreadsheet** (classId + className + schema version + lastExportedAt) so later opens/imports can be validated quickly and deterministically.
  - **Import refuses to overwrite local data when identity mismatches** (safe by default); optional explicit override is available but high-friction and clearly labeled destructive.

- **Non-goals**
  - Make Google Sheets the operational single source of truth (i.e., “always read from Sheets” / disable offline local operation).
  - Implement full multi-class-in-one-spreadsheet support (row-scoping across all tabs).
  - Solve Google auth/network reliability problems beyond surfacing actionable errors.

- **Acceptance checks**
  - From `Settings`, “Open Spreadsheet” shows the **current class name/id** on-screen, and if the sheet’s declared `classId` ≠ `selectedClassId`, the app **blocks open by default** with a clear message showing both class IDs.
  - “Sync/Export to Google Sheets” and “Import (overwrite)” are **blocked on identity mismatch** and never write/clear/import for the wrong class.
  - For a brand-new spreadsheet created by the app, subsequent actions succeed with no warnings (identity metadata present and correct).
  - For an older/legacy spreadsheet missing identity metadata, the app enters a **repair/migration path** (warn + offer to write identity metadata on next export) without silently proceeding to destructive import.
  - Settings schema is consistent: the sheet’s `Settings` header includes the columns the app writes/reads (including `lastExportedAt`).

- **Risk profile**
  - **Correctness**: high (prevents destructive cross-class overwrite/import; must be correct and conservative).
  - **Performance**: low/medium (adds a small Sheets read before certain actions; avoid repeated probes with short-lived caching).
  - **External integration**: high (Google Sheets API + auth; failures must degrade safely and explainably).

## 2) Authority & state ownership

- **Owner + decision point**
  - **Owner (authority)**: `web/src/store.ts` (class-scoped actions) remains the single place that decides whether export/import is allowed.
  - **Decision point**: `exportCurrentClassToSheets()` and `importCurrentClassFromSheets()` must call a single “spreadsheet identity probe” function and hard-stop on mismatch.

- **Dependency direction (Input → Domain → Infrastructure)**
  - **UI (Input)**: `web/src/pages/Settings.tsx` triggers actions and displays class context + validation results.
  - **Domain/Orchestration**: `web/src/store.ts` performs gating and owns the “safe defaults” policy (block vs warn vs override).
  - **Infrastructure**: `web/src/google.ts` provides:
    - ID normalization/validation (`normalizeAndValidateSpreadsheetId`)
    - ensuring schema (`ensureCheckpointSheets`, `createAndInitSpreadsheetForCheckPoint`)
    - **new** identity read/write helpers (probe + write identity row)
  - **No circular deps**: `Settings.tsx` → store → google/db; google must not import UI/store.

- **State owners**
  - **Source of truth (local)**: IndexedDB (`web/src/db.ts`) for classes/students/sessions/ledger/settings.
  - **Source of truth (sheet identity)**: Google Sheet `Settings` tab (identity + schema version + lastExportedAt).
  - **Cache**: React local state in `Settings.tsx` (e.g., `spreadsheetId` input) is a UI cache only; actions must re-read persisted settings or pass explicit values intentionally.

- **Persistence boundaries**
  - Reads/writes to Sheets must remain **async** and never block UI thread; errors must be captured and surfaced.
  - Import remains destructive to IndexedDB; therefore identity checks must occur **before** any local deletion/transaction begins.

## 3) Proposed approach (smallest viable change)

- **Phase 1 — Make class context explicit in Settings (UX guardrail)**
  - **Change**: Render “Active class: {name} ({id})” at top of `web/src/pages/Settings.tsx`.
  - **Where**: `Settings.tsx` (use store selectors already used to load class/settings).
  - **Why authority here**: UI-only mitigation; reduces operator error without changing data behavior.

- **Phase 2 — Define a spreadsheet identity contract (schema + version)**
  - **Change**: Extend the `Settings` tab header (in sheet initialization) to include:
    - `classId`, `className`, `defaultN`, `neverSeenWeight`, `cooldownWeight`, `schemaVersion`, `lastExportedAt`
  - **Where**: `web/src/google.ts` in `createAndInitSpreadsheetForCheckPoint()` and `ensureCheckpointSheets()`.
  - **Why authority here**: This is infrastructure schema ownership; keeps sheet invariants centralized.
  - **Complexity avoided**: No new tabs; no multi-row/multi-class design.

- **Phase 3 — Add identity probe helper (single implementation of “what sheet is this?”)**
  - **Change**: Add a helper in `web/src/google.ts` that reads a minimal range from `Settings` (or `Classes` as fallback) and returns:
    - `{ declaredClassId?, declaredClassName?, schemaVersion?, lastExportedAt?, isLegacyMissingIdentity: boolean }`
  - **Where**: `google.ts` alongside existing Sheets read/write utilities.
  - **Why authority here**: Keeps Google API read shape + parsing in one place; store uses a typed result.

- **Phase 4 — Gate export/import in store (hard safety boundary)**
  - **Change**: In `web/src/store.ts`:
    - `exportCurrentClassToSheets()`:
      - normalize id
      - probe identity
      - if legacy: migrate by writing identity row during export
      - if mismatch: block (error) unless explicit override flag is passed
      - write/overwrite identity metadata as part of export’s Settings write
    - `importCurrentClassFromSheets()`:
      - normalize id
      - probe identity
      - if legacy or mismatch: block import by default (offer repair/export-first guidance)
      - only proceed to destructive local transaction after identity match
  - **Why authority here**: This is the only safe place to prevent destructive operations; UI guards alone are insufficient.

- **Phase 5 — Gate “Open Spreadsheet” in Settings (prevent confusion)**
  - **Change**: Before `window.open()`, attempt identity probe (requires auth); if mismatch, block with explanation and show the sheet’s declared class.
  - **Where**: `web/src/pages/Settings.tsx` Open handler; it can call a store action like `verifyCurrentClassSpreadsheet()` to avoid importing google directly into UI.
  - **Why authority here**: Users experience mismatch first via “open”; preventing it reduces support/debug burden.
  - **Complexity avoided**: No multi-step wizard; keep it as a single “Verify then open” action.

- **Phase 6 — Prevent accidental spreadsheetId reuse across classes (local invariant)**
  - **Change**: When saving `spreadsheetId` for a class, check IndexedDB `settings` table for other classes already using that id; block or warn (default block).
  - **Where**: Prefer `web/src/store.ts` `updateClassSettings()` as the authority (avoid more direct `db.settings.put()` from `Settings.tsx`).
  - **Why authority here**: This is local consistency; prevents the most common footgun (same sheet overwriting across classes).

## 4) Impacted surfaces

- **UI**
  - `web/src/pages/Settings.tsx`: show active class label; gate Open; tighten how spreadsheetId is saved (route through store action).
  - (Optional) `web/src/pages/Home.tsx`: no behavior change; ensure class selection is obvious when navigating to Settings.

- **Domain / orchestration**
  - `web/src/store.ts`
    - `exportCurrentClassToSheets()`
    - `importCurrentClassFromSheets()`
    - `updateClassSettings()` (enforce spreadsheetId uniqueness; avoid direct DB writes elsewhere)

- **Infra**
  - `web/src/google.ts`
    - `createAndInitSpreadsheetForCheckPoint()`, `ensureCheckpointSheets()` (schema header alignment)
    - `normalizeAndValidateSpreadsheetId()` (ensure it supports URL paste already; keep as-is unless gaps found)
    - **new**: `probeCheckpointSpreadsheetIdentity()` + `writeCheckpointSpreadsheetIdentity()` (or similar)

- **Data / config**
  - Google Sheets `Settings` tab header + row format (migration support required).
  - IndexedDB `settings` rows: no schema change required beyond using existing fields; may add optional `schemaVersion` locally only if helpful (not required).

- **Tests**
  - `web/src/sync.test.ts`: extend/adjust to cover identity mismatch gating decisions if sync logic is intertwined.
  - Add focused unit tests near `google.ts` parsing/probing utilities (mock Sheets responses).
  - Add tests for “spreadsheetId reused across classes is blocked” behavior in store logic (pure function or mocked db layer).

- **Docs**
  - Update design docs later only if behavior changes materially (post-implementation); plan does not require doc edits now.

## 5) Edge cases & failure modes

- **EC1: User pasted a valid spreadsheet ID for another class**
  - **Intended failure mode**: hard-fail for export/import/open by default; show mismatch message.
  - **User-visible effect**: action blocked; clear guidance to switch class or use correct spreadsheet.

- **EC2: Legacy spreadsheet missing identity row/columns**
  - **Failure mode**: recover (non-destructive) by allowing export to “repair” identity; block destructive import until repaired.
  - **User-visible effect**: warning + “Run Sync/Export to repair sheet metadata” CTA.

- **EC3: No network / auth unavailable**
  - **Failure mode**: recover for local-only usage; block Sheets operations with actionable error.
  - **User-visible effect**: “Cannot verify sheet identity (offline). Try again when connected.”

- **EC4: Settings page local `spreadsheetId` differs from persisted settings (unsaved edits)**
  - Decide explicitly: Open/Sync should use either (a) the unsaved input with a prominent “unsaved” state, or (b) only saved value.
  - Plan default: treat unsaved input as “candidate,” verify it, but never persist unless user saves.

- **EC5: Spreadsheet tabs exist but Settings header schema drifted**
  - Ensure `ensureCheckpointSheets()` can detect and repair header mismatch (non-destructive).

- **EC6: Same spreadsheetId is configured on two classes locally**
  - **Failure mode**: hard-fail on save and/or on export (prevent overwrite).

- **EC7: Rapid class switching while Settings is open**
  - Ensure actions read `selectedClassId` at click time (store), not from a stale closure; disable buttons while verifying.

- **EC8: Partial export failure after clearing sheets**
  - Out of scope to fully solve, but identity gating reduces likelihood of destroying the wrong sheet; preserve existing conflict/guard patterns in `web/src/sync.ts`.

## 6) Verification plan

- **Automated**
  - Run unit tests: `cd web && npm test`
  - Add/extend tests to prove:
    - identity probe parsing (legacy vs current schema)
    - store gating: mismatch blocks export/import before any destructive action
    - spreadsheetId reuse across classes is blocked in `updateClassSettings()`

- **Minimal manual checks**
  - In browser:
    - Create two classes (A, B). Set spreadsheet for A. Confirm Settings shows “Active class: A”.
    - Switch to class B, open Settings, attempt to open A’s sheet: blocked with mismatch message.
    - Attempt import on mismatch: blocked; local B roster remains unchanged.
    - Export for A: succeeds and writes identity row; subsequent open succeeds without warning.

- **Evidence mapping to acceptance checks**
  - Screenshots/log output of mismatch block message showing both class IDs.
  - Confirm no IndexedDB deletions occur on blocked import (e.g., roster unchanged after attempted import).
  - Confirm Settings tab header contains `lastExportedAt` and identity fields after export.

## 7) Open questions / missing info

- Should “Open Spreadsheet” require auth/verification every time, or allow “open without verify” as an explicit secondary action (lower friction but riskier)?
  - **Blocks**: the exact UX for the Open button (single safe button vs split button).

- Do we want to strictly enforce “one spreadsheet per class,” or only block reuse *within the app* (local invariant) while still allowing manual user overrides?
  - **Blocks**: policy choice for spreadsheetId reuse handling.

- What is the desired behavior for legacy sheets with multiple classes already present?
  - **Blocks**: whether we treat them as unsupported (block) vs attempt to migrate (more complex; likely later).
