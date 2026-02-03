# review-implementation
#
# Purpose: Review an agent's *completed implementation* (not a plan) and decide whether it is ready to merge.
# This is an evidence-backed code review + verification checklist.
#
# Constraints
- Do **not** rewrite or modify code unless the user explicitly asks.
- Prefer **evidence over guesses**: diffs, call sites, runtime behavior, tests, logs.

## Required inputs (ask for what's missing)
- The **change set** to review:
  - A PR link, or a branch name, or a `git diff`/patch, or a list of changed files.
- The **contract** for the change:
  - A plan/spec file (e.g. `docs/scratch/<name>.plan.md`), or
  - A short statement of intended behavior + acceptance checks.
- Any **verification record** the agent already produced (tests run, manual checks, known gaps).

If the contract is missing, infer it from commit/PR description and code intent, then explicitly label it as **inferred**.

## Review Gates (do in order; write notes as you go)

### Gate 0 — Restate the contract you are reviewing
Write:
- **User-visible behavior** (2–5 bullets)
- **Non-goals** (1–3 bullets)
- **Acceptance checks** (2–8 bullets; observable, not "should be clean")
- **Risk profile**: correctness-critical / performance-sensitive / external-integration (APIs/files/databases)

### Gate 1 — Change-set map (diff-driven)
Build a minimal map:
- **Changed files** grouped by subsystem (UI / domain / infra / tooling / tests / docs)
- **New public APIs / events / exported functions** introduced
- **Data model/schema changes** (including JSON/config shapes)
- **Behavioral deltas**: what runtime behavior is now different (not just what code moved)

Red flags to call out early:
- Large unrelated refactors mixed into the change
- Hidden behavior changes via config/assets

### Gate 2 — Correctness & invariants (blockers live here)
Check:
- **Authority & state ownership**: one owner for the behavior; no duplicate/conflicting state
- **Dependency direction**: Input → Domain → Infrastructure; no new cycles
- **Ordering & lifecycle**:
  - No reliance on fragile initialization ordering for cross-component wiring
  - Proper cleanup (event listeners, timers, subscriptions, file handles)
- **Events & reentrancy**:
  - No double-subscriptions or missed unsubscriptions
  - Guard against rapid interactions / repeated callbacks if UI-driven

### Gate 3 — Boundary safety (files, APIs, external services)
If the change touches boundaries, check:
- Validation belongs at the boundary (not hidden null-checking inside core flows)
- Errors include context (current/expected state + remediation hints)
- No blocking calls on hot/UI paths; async operations remain non-blocking
- Paths handled correctly; no machine-specific absolute paths

### Gate 4 — Performance footguns
Only go deep where relevant:
- **Hot paths**: allocations in tight loops, unnecessary iterations, inefficient algorithms
- **UI**: avoid full rebuilds when only partial updates needed; one refresh authority
- **Async operations**: proper cancellation, no memory leaks from dangling promises/callbacks

### Gate 5 — Tests & verification evidence
Prefer evidence-based answers:
- **What automated tests cover this?** (unit, integration, e2e)
- **What manual checks were performed?** (scenarios, edge cases)
- **What is NOT verified?** List explicitly with risk.

If no tests exist:
- Decide whether that is acceptable. If not, mark as a **blocker** and recommend the smallest test that would catch the regression.

## Output format (required)
Respond in Markdown with this structure:

1. **Merge verdict**
   - One of: **Approve**, **Approve with nits**, **Request changes (blockers)**.
   - 2–4 sentences explaining why.

2. **Contract check**
   - **Acceptance checks** table:
     - Each check → `verified` / `not verified` / `failed` + evidence (test name, repro steps, code pointer).

3. **Findings**
   - **Blockers** (must fix before merge)
   - **Major** (correctness/maintainability risks; should fix soon)
   - **Minor** (cleanup; safe to defer)
   - **Nits** (style/consistency)

For each finding, include:
- **Where** (file + symbol)
- **Why it matters** (risk/impact)
- **Suggested fix** (1–3 bullets, no large rewrites unless necessary)

4. **Regression watchlist**
   - 3–8 bullets: the most likely places regressions will appear and the fastest way to detect them.

5. **Follow-ups (optional)**
   - Small, well-scoped tickets that should be filed after merge (if not blockers).

## Style rules
- Be direct, concrete, and diff-aware.
- Prioritize correctness + invariants + lifecycle safety over aesthetics.
- Do not invent requirements; if something is unclear, label it and propose what evidence would resolve it.
