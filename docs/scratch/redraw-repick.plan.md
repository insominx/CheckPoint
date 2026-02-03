Last Edited: 2026-02-03

## 1) Contract

### Behavior
- **Re-draw works during an active draft session**: clicking **Re-draw** regenerates the *random* portion of `currentSession.picks` while keeping `currentSession.carryoverIds` included.
  - Authority anchor: `web/src/pages/Session.tsx` Re-draw button → `useStore().redrawRandom()`
  - Domain anchor: `web/src/store.ts` `redrawRandom()` / pick logic
- **No silent no-ops**: if Re-draw cannot proceed (e.g. due to in-flight pick operation), the user gets a visible outcome (disabled state or message), not a silent return.
  - Current issue anchor: `web/src/store.ts` `pickStudents()` early return via `canStartOperation(...)`
- **Marks remain consistent with picks**: after any redraw, the invariant holds: `Object.keys(currentSession.marks) ⊆ currentSession.picks`, so `saveSession()` cannot persist “invisible” marks.
  - Persistence anchor: `web/src/store.ts` `saveSession()` derives ledger entries by iterating `sessionToSave.marks`

### Non-goals
- Changing the selection algorithm (carryover computation, never-seen weighting, cooldown) beyond what is needed to *invoke it* for redraw.
  - Anchor: `web/src/store.ts` `pickStudents()` algorithm; sampler `web/src/sampling.ts`
- Adding E2E tooling (no Playwright wiring in this repo).
  - Anchor: `docs/archive/v1-code-quality-improvements.md` (tests are unit-level)

### Acceptance checks (observable outcomes)
- **AC1**: Start a session with no marks; click Re-draw; `currentSession.picks` changes for the random portion when eligible pool allows it, and all carryovers remain included.
  - UI anchor: `web/src/pages/Session.tsx`
- **AC2**: When any student is already marked, Re-draw follows a clear policy (see approach), and the end state preserves the invariant `marks ⊆ picks`.
  - Store anchor: `web/src/store.ts` `markStudent()`, `redrawRandom()`
- **AC3**: Rapidly click Re-draw; the app remains stable (no crashes, no inconsistent partial draft), and repeated redraws are blocked only while a redraw is in progress.
  - Guard anchor: `web/src/store.ts` `isPickingStudents`; `web/src/sync.ts` `canStartOperation()`
- **AC4**: Re-draw never reintroduces the original concurrent-pick race (the guard still prevents overlapping pick/redraw operations).
  - Doc anchor: `docs/archive/v1-code-quality-improvements.md` “Race Condition in pickStudents”

### Risk profile
- **Correctness-critical**: high (involves session draft state + persistence invariants).
- **Performance**: low-medium (redraw does Dexie reads + a sampling loop; expected roster sizes are small/medium).
- **External integrations**: none for redraw itself (but must not break autosave `localStorage` or session save).

---

## 2) Authority & state ownership

### Owner + decision point
- **Single authority component**: Zustand store `useStore` in `web/src/store.ts`.
- **Decision point**: `web/src/store.ts` `redrawRandom()` (and any helper it delegates to) owns redraw semantics and invariants.

### Dependency direction (Input → Domain → Infrastructure)
- **Input/UI**: `web/src/pages/Session.tsx` (button + disable/policy messaging).
- **Domain orchestration**: `web/src/store.ts` (reads DB, computes picks, updates draft session).
- **Infrastructure**: Dexie DB `web/src/db.ts` / tables used by `pickStudents()`; local draft persistence via `localStorage` subscription in `web/src/store.ts`.

### State owners
- **Source of truth (durable)**: Dexie (`db.sessions`, `db.ledger`, `db.students`, `db.settings`) in `web/src/db.ts`.
- **Working state (draft)**: `useStore().currentSession` in `web/src/store.ts`.
- **Cache/persistence mirror**: `localStorage` key `checkpoint_draft_session_<classId>` written by `useStore.subscribe(...)` in `web/src/store.ts`.

### Persistence boundaries
- Redraw should remain a **draft-only** operation (no IndexedDB writes until `saveSession()`).
  - Anchors: `web/src/store.ts` `pickStudents()` only reads; `saveSession()` writes.

---

## 3) Proposed approach (smallest viable change)

This plan intentionally avoids a schema refactor (no new persisted fields) and focuses on making redraw correct + safe.

### Step 1 — Define an explicit redraw policy for partial marks (and encode it)
- **Decision**: safest MVP policy:
  - If **no marks** exist (`Object.keys(currentSession.marks).length === 0`): allow redraw immediately.
  - If **any marks** exist: require explicit confirmation to proceed, and redraw **resets marks** (clears `marks`), then generates new random picks (carryovers retained).
- **Why**: avoids ambiguous partial-mark semantics and guarantees `marks ⊆ picks` trivially.
- **Where**:
  - UI policy prompt: `web/src/pages/Session.tsx` (confirmation before calling store, or call store and have store return a status that UI handles).
  - State reset: `web/src/store.ts` `redrawRandom()`.

### Step 2 — Unblock redraw by separating “initial pick” and “redraw pick” guard semantics
- **What changes**:
  - Today, redraw delegates to `pickStudents()` which is blocked by `canStartOperation(..., !!currentSession)`.
  - Implement a redraw path that is allowed when a session exists but still guarded against concurrent operations.
- **Where (preferred)**:
  - `web/src/store.ts`: refactor `pickStudents()` internals into a shared helper (inside `store.ts`) that takes an option like `mode: 'initial' | 'redraw'`.
  - In **initial** mode: keep current behavior (don’t overwrite an existing draft).
  - In **redraw** mode: allow overwriting draft picks.
- **Why this authority location**:
  - The store already owns `isPickingStudents`, sets `currentSession`, and controls draft invariants + autosave.

### Step 3 — Ensure redraw updates are atomic at the “draft state” level
- **What changes**:
  - Update `currentSession` in a single `set(...)` so autosave doesn’t persist intermediate invalid drafts.
  - Maintain invariant: `carryoverIds ⊆ picks`.
- **Where**:
  - `web/src/store.ts` `redrawRandom()` implementation.

### Step 4 — Make “no silent no-op” true in the UI
- **What changes**:
  - If redraw is blocked due to `isLoading`/`isPickingStudents`, the button is disabled (already partially true via `isLoading`), and/or show a message when blocked.
- **Where**:
  - `web/src/pages/Session.tsx` (button disabled state + optional small banner/toast copy).
  - Store: consider returning a boolean from `redrawRandom()` indicating whether it executed (optional).

### Step 5 — Add unit-level coverage for redraw invariants (without UI harness)
- **What changes**:
  - Add tests around the pure sampling/eligibility/carryover logic if needed, and add a small unit test for the guard semantics if `sync.ts` changes.
- **Where**:
  - If guard logic is changed: `web/src/sync.test.ts` for `canStartOperation(...)`.
  - If new pure helper is extracted for redraw-specific “marks subset of picks” behavior: put it in `web/src/attendance.ts` (or a small new pure module) and add tests next to it.

### Complexity avoided
- No persisted schema change to `SessionEntity` (e.g., storing `randomIds` separately).
- No new multi-step “draft session state machine”.
- No E2E framework addition.

---

## 4) Impacted surfaces

### UI
- `web/src/pages/Session.tsx`
  - Re-draw click behavior, disable/confirm policy, and user-visible feedback.

### Domain orchestration / state authority
- `web/src/store.ts`
  - `pickStudents()` guard semantics (initial pick vs redraw).
  - `redrawRandom()` to actually change draft state safely.
  - Ensure `saveSession()` invariant is respected (by clearing/pruning marks on redraw).

### Guard helpers
- `web/src/sync.ts` / `web/src/sync.test.ts`
  - Only if changing `canStartOperation()` signature/semantics (preferred: don’t; keep change localized to store).

### Docs (optional follow-up)
- `docs/product/prd.md`, `docs/product/design-overview.md`
  - Update redraw policy wording if we add confirmation/reset semantics.

---

## 5) Edge cases & failure modes

1) **Rapid Re-draw clicks**:
   - Intended: first click runs; subsequent clicks during operation are blocked (button disabled) and/or safely no-op with feedback.
   - Anchors: `web/src/store.ts` `isPickingStudents`; `web/src/pages/Session.tsx` disable logic.
2) **Re-draw with partial marks**:
   - Intended: confirm → redraw clears marks → new picks.
   - User-visible: clear “this will reset marks” text.
3) **Eligible pool small/empty**:
   - Intended: redraw still completes; random portion may be smaller; picks may equal carryovers only.
   - Anchors: `web/src/sampling.ts` behavior when pool smaller than sample size.
4) **All weights zero/negative**:
   - Intended: sampler returns fewer than N; redraw still succeeds (no crash).
   - Anchor: `web/src/sampling.ts` `totalWeight <= 0` early break.
5) **Draft persistence interactions**:
   - Intended: redraw results in a single coherent `currentSession` write to `localStorage`; no intermediate broken JSON.
   - Anchor: `web/src/store.ts` `useStore.subscribe(...)`
6) **User navigates away mid-redraw**:
   - Intended: no crash; draft remains consistent.
   - Anchor: `web/src/pages/Session.tsx` navigation behavior; store holds state.
7) **Guard conflict with initial pick effect**:
   - Intended: the initial pick effect (`!currentSession`) still works; redraw does not cause the effect to loop.
   - Anchor: `web/src/pages/Session.tsx` effect dependencies.

At least 3 “failure-mode styles”:
- **Hard-fail**: if DB reads throw, show `error` (store already sets `error` in some actions) and keep existing draft intact.
  - Anchor: `web/src/store.ts` `pickStudents()` try/catch.
- **Recover**: if redraw blocked due to in-progress operation, keep current picks and show disabled state/message.
- **Best-effort**: if sampler returns fewer picks, accept shorter random portion rather than failing.

---

## 6) Verification plan

### Tests to run
- `cd web && npm test`
  - Confirm existing suites still pass: `web/src/sync.test.ts`, `web/src/attendance.test.ts`, `web/src/validation.test.ts`.
- Add/extend unit tests depending on chosen implementation:
  - If guard semantics change: extend `web/src/sync.test.ts`.
  - If a pure helper for redraw is introduced: add a new unit test file (or extend `attendance.test.ts`) to assert invariants (`marks ⊆ picks`, carryovers preserved).

### Minimal manual checks
- In browser:
  - Create/select a class, import roster, start session.
  - Click Re-draw multiple times; confirm picks change (when eligible pool allows).
  - Mark one student; click Re-draw; confirm dialog appears; accept → marks cleared and new picks displayed.
  - Save after redraw; verify History shows saved session and ledger only reflects marked absences.
    - Anchors: `web/src/pages/History.tsx` + `web/src/store.ts` `saveSession()`

### Evidence mapping to acceptance checks
- AC1: visually compare pick set; optionally log currentSession.picks in devtools.
- AC2: after redraw, ensure UI shows 0/X marked and Save disabled until all are re-marked.
  - Anchor: `web/src/pages/Session.tsx` `allMarked` and Save disabled logic.
- AC3/AC4: attempt rapid clicks; app remains stable and doesn’t duplicate operations.

---

## 7) Open questions / missing info

- **Q1: What should happen to partially entered marks on redraw?**
  - Decision it blocks: whether we implement “confirm + reset marks” (MVP-safe) vs “preserve & prune marks” (more complex).
  - Anchors: `web/src/store.ts` `saveSession()` derives ledger from `marks`; `web/src/pages/Session.tsx` UX expectations.
- **Q2: Should redraw keep the same `currentSession.id` (draft identity) or generate a new one each time?**
  - Decision it blocks: whether redraw is “mutate picks in-place” vs “regenerate draft session object”.
  - Anchor: `web/src/store.ts` `pickStudents()` assigns new `id`/`date`.

