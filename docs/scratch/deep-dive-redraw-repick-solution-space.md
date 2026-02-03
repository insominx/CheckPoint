Last Edited: 2026-02-03
Topic: Re-draw / re-pick behavior (regenerating random picks safely)
Inputs:
- Docs: `docs/archive/v1-code-quality-improvements.md`, `docs/product/prd.md`, `docs/product/design-overview.md`, `docs/implementation/implementation-plan.md`, `docs/scratch/understand-state-management.md`
- Code: `web/src/store.ts` (`pickStudents()`, `redrawRandom()`, autosave subscription, `saveSession()`), `web/src/pages/Session.tsx` (Re-draw button + effects), `web/src/sync.ts` (`canStartOperation()`), `web/src/sampling.ts` (`weightedSampleWithoutReplacement()`)

---

### 0) Executive synthesis (dense)

- **What’s happening (ground truth)**:
  - “Re-draw” is wired (`Session.tsx`) to `useStore().redrawRandom()`, which currently delegates to `pickStudents()` (`store.ts`).
    - Anchors: `web/src/pages/Session.tsx` Re-draw button; `web/src/store.ts` `redrawRandom()`
  - `pickStudents()` is guarded by `canStartOperation(isPickingStudents, !!currentSession)`. When a session is already present (normal case during an active session), `!!currentSession` is `true`, so `canStartOperation()` returns `false` and `pickStudents()` returns early.
    - Anchors: `web/src/store.ts` `pickStudents()` guard; `web/src/sync.ts` `canStartOperation()`
  - Therefore, **Re-draw is effectively a no-op** during an active draft session.

- **Why it’s hard**:
  - “Re-draw” is supposed to regenerate the **random portion** while **carryovers stay** (documented intent), but the current data model stores only `picks` + optional `carryoverIds` + `marks`.
    - Anchors: `docs/product/design-overview.md` Session workflow step “Re-draw…”; `docs/implementation/implementation-plan.md` selection algorithm step 5; `web/src/types.ts` `SessionEntity`
  - A safe redraw must define what happens to already-entered `marks` (keep? reset? prune?), otherwise `saveSession()` may persist marks for students no longer in `picks` (because `saveSession()` iterates over `sessionToSave.marks`, not `picks`).
    - Anchor: `web/src/store.ts` `saveSession()` absent-entry derivation loop

- **What’s at risk**:
  - UX break: teachers cannot re-sample if a pick set looks “off”.
  - Correctness: redraw implementations that don’t reconcile `marks` with `picks` can save inconsistent sessions.
  - Safety: redraw that resets a session can silently discard user work (already marked students) unless the policy is explicit.

- **What we know vs don’t know yet**:
  - **Known**: intended behavior says “carryovers stay; random portion changes” (`design-overview.md`, `implementation-plan.md`, `prd.md`).
  - **Known**: current guard blocks repick when a `currentSession` exists (`store.ts` + `sync.ts`).
  - **Unknown**: desired policy when some picks are already marked (keep marks for students still present? forbid redraw after marking? confirm dialog?).
  - **Unknown**: whether “Re-draw” should keep the same session `id`/`date` or treat each redraw as a new draft session identity (current `pickStudents()` creates a new `id` each time).
    - Anchor: `web/src/store.ts` `pickStudents()` assigns `id: uuidv4()` and `date: new Date().toISOString()`

---

### 1) Problem definition + scope boundaries

- **Problem statement**:
  - The app exposes a **Re-draw** control intended to regenerate the random student selection during an active session while keeping carryovers. Today, Re-draw is blocked by the race-condition guard in `pickStudents()` and does not change picks during an active session. We need a solution that enables repick/redraw safely without reintroducing the original race condition or causing state inconsistencies (especially around `marks`, autosave drafts, and eventual persistence).

- **In scope**
  - Re-draw / repick semantics in the Session workflow.
  - Store guard semantics (`isPickingStudents`, `canStartOperation`) as they affect repick.
  - Data integrity when regenerating `picks`, `carryoverIds`, and `marks`.
  - Interaction with draft persistence (`localStorage`) and save behavior.

- **Out of scope**
  - Changing the selection algorithm itself (weights, carryover computation) except insofar as redraw needs to call it.
  - UI design changes beyond what’s needed to make behavior safe/explicit (though policy UI is part of solution space).

- **Definitions**
  - **Carryovers**: students with an unresolved absence (most recent absence more recent than most recent present mark).
    - Anchors: `web/src/store.ts` carryover derivation in `pickStudents()`; `docs/implementation/implementation-plan.md` Derived behavior
  - **Random portion**: `randomIds = picks \ carryoverIds` (conceptual; not stored explicitly).
    - Anchor: `web/src/types.ts` `SessionEntity.picks` + optional `carryoverIds`
  - **Draft session**: `currentSession` in Zustand, persisted to `localStorage` under `checkpoint_draft_session_<classId>`.
    - Anchor: `web/src/store.ts` autosave subscription + `restoreDraftSession()`

- **Observable symptoms**
  - Clicking “Re-draw” does not change the displayed picks.
  - No error is surfaced; it silently returns early (because guard simply returns).
    - Anchors: `web/src/store.ts` `pickStudents()` early return; `web/src/pages/Session.tsx` Re-draw button calls `redrawRandom()` without feedback

---

### 2) Current state (ground truth)

- **What the system does today**
  - Session page boot:
    - If there’s no `currentSession`, it calls `pickStudents()` to create one.
    - Anchor: `web/src/pages/Session.tsx` effect `if (!currentSession && selectedClassId) pickStudents()`
  - Re-draw button:
    - Calls `redrawRandom()` which calls `pickStudents()`.
    - Anchors: `web/src/pages/Session.tsx` Re-draw; `web/src/store.ts` `redrawRandom()`
  - Guard:
    - `pickStudents()` returns early if `currentSession` exists (`hasExistingResult=true`).
    - Anchor: `web/src/store.ts` guard + `web/src/sync.ts` `canStartOperation()`

- **Where the issue is detected/emitted**
  - It’s not “detected”; the guard returns early with no state change and no error.
  - Anchor: `web/src/store.ts` `if (!canStartOperation(...)) return`

- **Impact evidence**
  - Docs claim Re-draw is implemented and should work:
    - `docs/product/design-overview.md`: “Re-draw regenerates the random portion if needed (carryovers stay)”
    - `docs/implementation/implementation-plan.md`: “Re-draw regenerates the random portion… until Save”
    - `docs/product/prd.md`: Session controls include Re-draw button

---

### 3) Edge-case taxonomy (explicit)

- **EC1 — Re-draw before any marks**
  - Draft exists, `marks` empty.
  - Primary risk: none (safe to replace picks freely), but must preserve carryovers semantics.

- **EC2 — Re-draw after some marks entered**
  - Some students are marked present/absent in `currentSession.marks`.
  - Key question: are those marks “committed” to the draft session or can they be discarded?
  - Risk: losing teacher input or saving marks for students no longer shown.
  - Anchor: `web/src/store.ts` `saveSession()` iterates `marks`, not `picks`.

- **EC3 — Carryover set changes between redraws**
  - In theory carryovers derive from saved ledger + saved sessions; during an unsaved draft, underlying ledger doesn’t change.
  - Still relevant if user corrects history in another tab or via sync/import while session is open (rare but possible).
  - Risk: recomputing carryovers vs freezing them can diverge.
  - Anchors: `web/src/store.ts` carryover computation uses `db.ledger` + `db.sessions`.

- **EC4 — Eligible pool too small / empty**
  - Redraw should degrade gracefully (random portion may shrink to 0).
  - Anchor: `web/src/sampling.ts` sampler returns up to pool length; breaks if totalWeight <= 0.

- **EC5 — Weight pathologies**
  - All weights become 0/negative (sampler breaks early).
  - Anchor: `web/src/sampling.ts` clamps weights via `Math.max(it.weight, 0)` and stops if `totalWeight <= 0`.

- **EC6 — Guard / concurrency**
  - Multiple repick clicks, or effect + click races.
  - Must not reintroduce the original “pickStudents race condition” that led to `isPickingStudents`.
  - Anchor: `docs/archive/v1-code-quality-improvements.md` “Race Condition in pickStudents”

- **EC7 — Draft persistence while redrawing**
  - Autosave writes `currentSession` to `localStorage` for every update; redraw can create a burst of updates.
  - Risk: transient inconsistent draft states if redraw is multi-step (set undefined then set new).
  - Anchor: `web/src/store.ts` `useStore.subscribe(...)`

- **EC8 — Session identity semantics**
  - Redraw currently implies a brand new `SessionEntity` with a new UUID and new timestamp.
  - Question: should redraw mutate `id`/`date`, or keep them stable until Save?
  - Anchor: `web/src/store.ts` `pickStudents()` assigns `id` + `date` each time.

- **EC9 — Marks pruning rules**
  - If we keep marks across redraw, we must prune marks for students removed from picks, otherwise save persists “invisible” marks.
  - Anchor: `web/src/store.ts` `saveSession()` ledger derivation from marks.

- **EC10 — UI affordance / policy clarity**
  - If redraw is allowed after marking, we likely need a confirm or a “reset marks” behavior to avoid surprise.
  - Anchor: `web/src/pages/Session.tsx` currently provides no confirmation UI.

---

### 4) Solution space (the corpus)

Below are options (minimum 10), ranging from minimal fixes to heavier state-machine refactors.

#### Option 1 — Make the guard only about in-flight operations (minimal)
- **Idea**: Change `canStartOperation()` (or its usage) so it only blocks when `isPickingStudents` is true; don’t block when `currentSession` exists.
- **What it changes (and where)**:
  - `web/src/store.ts` `pickStudents()` guard usage OR `web/src/sync.ts` `canStartOperation()`.
- **Pros**:
  - Smallest diff; makes Re-draw work immediately.
  - Preserves original intent of preventing concurrent picks.
- **Cons**:
  - Now “Pick Students” can overwrite an existing draft session from the Session page’s “Generate Picks” button (could be desirable or not).
- **Failure modes / risks**:
  - If called while marks exist, it resets the session (new `id`, empty marks) with no confirmation.
- **Phase fit**: MVP.

#### Option 2 — Parameterize the guard (“start” vs “redraw”)
- **Idea**: Keep `canStartOperation()` as-is, but allow `pickStudents({ allowExistingSession: true })` when invoked from `redrawRandom()`.
- **What it changes**:
  - `web/src/store.ts`: change signatures of `pickStudents` and `redrawRandom`.
- **Pros**:
  - Preserves strict “start” semantics while enabling redraw.
  - Explicit policy at call site.
- **Cons**:
  - API change to store action (touches call sites).
- **Failure modes / risks**:
  - Still must decide what happens to marks on redraw.
- **Phase fit**: MVP.

#### Option 3 — Redraw clears `currentSession` then repicks (two-step)
- **Idea**: In `redrawRandom()`, set `currentSession` to `undefined` first, then call `pickStudents()`.
- **What it changes**:
  - `web/src/store.ts` `redrawRandom()`.
- **Pros**:
  - Works with current guard unchanged (because `!!currentSession` becomes false).
- **Cons**:
  - Two-step state change interacts with autosave (`localStorage`) and may briefly persist “no session”.
  - UI may briefly flicker to the “no currentSession” branch.
    - Anchor: `web/src/pages/Session.tsx` `if (!currentSession) { ... }`
- **Failure modes / risks**:
  - If the second step fails, user loses the draft session entirely.
- **Phase fit**: MVP (but riskier UX).

#### Option 4 — Implement “true redraw” without generating a whole new session object
- **Idea**: Recompute only `randomIds` and replace `picks = carryoverIds ∪ randomIds` while keeping `currentSession.id/date` stable.
- **What it changes**:
  - `web/src/store.ts` `redrawRandom()` would need to run the selection logic directly and update `currentSession.picks`.
- **Pros**:
  - Better conceptual match to “redraw random portion”.
  - Avoids changing session identity.
- **Cons**:
  - Must reconcile `marks` carefully:
    - either prune marks not in new picks, or disallow redraw once marking starts.
- **Failure modes / risks**:
  - If marks aren’t pruned, `saveSession()` can persist marks for removed students.
- **Phase fit**: MVP+ (needs careful invariants).

#### Option 5 — Disallow redraw after any mark; require explicit “Reset session”
- **Idea**: Allow redraw only when `currentSession.marks` is empty. After marking, show “Reset session” with confirmation (clears marks and repicks).
- **What it changes**:
  - `web/src/pages/Session.tsx` (disable/redraw button logic + messaging), and store methods to support reset.
- **Pros**:
  - Eliminates ambiguous partial-mark states.
  - Prevents silent data loss.
- **Cons**:
  - Less flexible if teacher realizes early picks are wrong after marking one student.
- **Failure modes / risks**:
  - Policy may frustrate users; needs clear copy.
- **Phase fit**: MVP.

#### Option 6 — Preserve marks for students that remain in picks; prune the rest
- **Idea**: On redraw, compute new picks, then set:
  - `marks' = { sid in newPicks ? oldMarks[sid] : undefined }`
  - `reasonById` is local UI state; it can remain, but should also be pruned to avoid confusion.
- **What it changes**:
  - `web/src/store.ts` `redrawRandom()` to update `currentSession.picks` and `currentSession.marks` consistently.
  - (Optional) `web/src/pages/Session.tsx` to prune local `reasonById` when picks change.
- **Pros**:
  - Keeps teacher work for students that stay in set.
  - Maintains `saveSession()` correctness (marks remain subset of picks).
- **Cons**:
  - More complex; needs test coverage.
- **Failure modes / risks**:
  - If carryovers are recomputed and change, previously marked carryovers might disappear (unexpected).
- **Phase fit**: MVP+.

#### Option 7 — Store explicit session structure: `carryoverIds` + `randomIds`
- **Idea**: Evolve the draft session model to persist both `carryoverIds` and `randomIds` separately. Redraw replaces only `randomIds`.
- **What it changes**:
  - Data model (`web/src/types.ts`) and store/session UI.
- **Pros**:
  - Cleanest semantics; avoids recomputing set diffs.
  - Enables robust UI like “these are carryovers vs random picks”.
- **Cons**:
  - Schema change touches many call sites and persistence (sessions saved to IndexedDB and exported to Sheets).
  - Back-compat migration considerations.
- **Failure modes / risks**:
  - Migration bugs; increased blast radius.
- **Phase fit**: Later phase.

#### Option 8 — Introduce a draft-session state machine (`status: 'draft'|'saved'|'discarded'`)
- **Idea**: Make redraw and save transitions explicit and guarded by status. Add invariants like “redraw allowed only in draft”.
- **What it changes**:
  - `web/src/types.ts` add status; `web/src/store.ts` actions enforce transitions; UI updates.
- **Pros**:
  - Makes lifecycle-order issues visible and testable.
- **Cons**:
  - Larger refactor; not strictly needed for redraw.
- **Failure modes / risks**:
  - Complexity overhead; risk of regressions.
- **Phase fit**: Later phase.

#### Option 9 — Add a deterministic seed to the draft and change it on redraw
- **Idea**: Store a `seed` in `currentSession` and pass it to `weightedSampleWithoutReplacement(...)`. Redraw regenerates seed (or increments a nonce).
- **What it changes**:
  - `web/src/store.ts` `pickStudents()` and `redrawRandom()`; `web/src/sampling.ts` already supports seeds via options.
    - Anchor: `web/src/sampling.ts` `SamplerOptions.seed?`
- **Pros**:
  - Debuggability: you can reproduce a draw given the same seed.
  - Testability: easier to assert redraw changes.
- **Cons**:
  - Still must handle marks/picks integrity.
- **Failure modes / risks**:
  - If seed is persisted and reused unintentionally, “random” may look stuck.
- **Phase fit**: MVP+ (optional enhancement).

#### Option 10 — Add explicit “Re-draw random only” action that never touches carryovers
- **Idea**: Freeze carryovers as `currentSession.carryoverIds` (do not recompute from DB during redraw). Only resample from eligible excluding carryovers.
- **What it changes**:
  - `web/src/store.ts` `redrawRandom()` selection implementation.
- **Pros**:
  - Matches user expectation: carryovers “stay” even if underlying DB changes during session.
- **Cons**:
  - If carryovers were computed wrong at session start (data issue), redraw won’t correct it.
- **Failure modes / risks**:
  - Cross-tab changes (history corrections) won’t be reflected.
- **Phase fit**: MVP+.

#### Option 11 — UI-only: remove Re-draw button; expose “Cancel session” + “Start new”
- **Idea**: Avoid the redraw complexity: let users cancel/discard the draft and start a new session.
- **What it changes**:
  - UI (`web/src/pages/Session.tsx`) and store method to discard draft safely.
- **Pros**:
  - Simplifies invariants; no partial redraw.
- **Cons**:
  - Loses a key UX feature promised by docs.
- **Failure modes / risks**:
  - Teacher loses marks if they forget to save before restarting.
- **Phase fit**: MVP fallback (if redraw remains problematic).

#### Option 12 — Add instrumentation + explicit error surfacing when guard blocks redraw
- **Idea**: Keep current semantics but surface why redraw didn’t happen (banner/toast).
- **What it changes**:
  - `web/src/store.ts` return a status value; `Session.tsx` displays it.
- **Pros**:
  - Improves debuggability and reduces “silent no-op”.
- **Cons**:
  - Doesn’t fix behavior; only makes it observable.
- **Failure modes / risks**:
  - Users still can’t redraw; they just learn why.
- **Phase fit**: MVP supplement (not sufficient alone).

---

### 5) Trade-off matrix (forced clarity)

| Option | Complexity | Semantics risk | Determinism risk | Blast radius | MVP compatible | Debuggable | Testable |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 Guard only in-flight | Low | Medium (marks reset) | Low | Low | High | Medium | High |
| 2 Parameterize guard | Low-Med | Medium | Low | Low | High | High | High |
| 3 Clear then repick | Low | High (draft loss/flicker) | Low | Low | Medium | Medium | Medium |
| 4 True redraw mutate picks | Med | Medium-High | Low | Med | Medium | Medium | Medium |
| 5 Disallow after marking | Med | Low | Low | Med (UI change) | High | High | High |
| 6 Preserve+prune marks | Med-High | Low-Med | Low | Med | Medium | Medium | Medium-High |
| 7 Store randomIds explicitly | High | Low | Low | High | Low | High | High |
| 8 Draft state machine | High | Low | Low | High | Low | High | High |
| 9 Seeded redraw | Med | Medium | Medium | Med | Medium | High | High |
| 10 Freeze carryovers | Med | Medium | Low | Med | Medium | Medium | Medium |
| 11 Cancel + new session | Med | Medium | Low | Med | Medium | High | High |
| 12 Surface guard status | Low | Low | Low | Low | High | High | High |

---

### 6) Diagnostics & evidence plan (make it falsifiable)

- **Fast probe (cheap, high-signal)**:
  - Start a session, click Re-draw, observe whether `currentSession.id` or `currentSession.picks` changes.
  - Expected today: **no change** because `pickStudents()` returns early.
  - Anchors: `web/src/store.ts` guard; `web/src/pages/Session.tsx` Re-draw wiring.

- **Deep probe (more work, more certainty)**:
  - Add unit tests (or a small store-level harness) validating redraw invariants:
    - Redraw changes random portion when possible.
    - Carryovers remain included.
    - After redraw, `marks` is either empty (policy) or subset of `picks` (policy).
    - `saveSession()` persists only marks consistent with picks (derive ledger only from marks).
  - Anchors for existing test style: `web/src/sync.test.ts`, `web/src/attendance.test.ts`.

- **Proposed on-disk artifact (optional)**
  - If you want reproducibility, store a draft-only object in `localStorage` under a debug key:
    - `checkpoint_debug_last_redraw_<classId>`: `{ at, oldPicks, newPicks, carryoverIds, eligibleCount, seed? }`
  - This is purely for diagnosis; should be gated and removable.

---

### 7) Hazard scoring + policy mapping

Define hazard classes for redraw decisions:

- **H0 (safe)**: No marks set (`Object.keys(currentSession.marks).length === 0`).
- **H1 (moderate)**: Some marks set, but policy is to reset all marks on redraw (requires confirm).
- **H2 (high)**: Some marks set and policy is to preserve marks for overlapping picks (requires prune + tests).
- **H3 (systemic)**: Cross-tab mutations likely (history correction/import/sync while session open); redraw must choose recompute vs freeze semantics.

Policy mapping:

- **H0**: redraw should proceed without confirmation.
- **H1**: redraw proceeds only with confirmation; result clears marks.
- **H2**: redraw proceeds only if prune invariant is enforced: `marks ⊆ picks` after redraw.
- **H3**: prefer recomputing carryovers from DB (truth) OR freezing carryovers (session integrity); choose and document explicitly.

---

### 8) Minimal experiments to choose direction

- **E1**: Decide policy for marks on redraw.
  - Setup: start session; mark 1 student; click redraw.
  - Signals: user expectation (does their work reset?).
  - Decision enabled: choose Option 5 (disallow after mark) vs Option 6 (preserve+prune) vs “always reset with confirm”.
  - Falsifier: if teachers routinely need redraw after marking, disallowing becomes unacceptable.

- **E2**: Confirm carryover semantics for redraw.
  - Setup: include at least one carryover; click redraw multiple times.
  - Signal: carryover must remain present in picks.
  - Decision enabled: freeze carryovers (Option 10) vs recompute each redraw.

- **E3**: Verify guard correctness under rapid clicks.
  - Setup: click redraw rapidly 5–10 times.
  - Signal: no crashes, no partial state, no “double session” weirdness.
  - Decision enabled: guard approach (Options 1/2) vs more robust operation-state machine.

- **E4**: Validate “marks subset of picks” invariant.
  - Setup: implement a candidate and ensure it can’t create marks for removed students.
  - Signal: `saveSession()` creates ledger entries only for displayed/picked students.
  - Decision enabled: whether Option 4/6 are safe.

---

### 9) “MVP honest” framing (no overcommitment)

Recommended sequencing (safety + observability first):

- **Now (MVP fix)**:
  - Unblock Re-draw by adjusting the guard (Option 2 is the cleanest minimal change).
  - Pick a clear marks policy:
    - simplest: allow redraw only when no marks (Option 5) OR confirm-and-reset.
  - Add minimal observability: if a redraw is blocked, tell the user why (Option 12).

- **Next (evidence-driven improvements)**:
  - If users need redraw after partial marking, implement preserve+prune (Option 6) with tests.
  - Consider seed-based reproducibility (Option 9) if debugging sampling complaints becomes common.

- **Later (architectural cleanup)**:
  - If redraw/pick complexity grows (or more draft workflows appear), consider explicit random/carryover separation (Option 7) or a draft state machine (Option 8).

