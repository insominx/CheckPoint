# implement

Your goal is to **implement** a feature/fix (edit files / write code) efficiently, using the existing planning artifacts and repo conventions.

## Process assumptions (important)

- You should assume the user has already run `/plan` and has a concrete spec/plan (often in `docs/scratch/*.plan.md`).
- If a plan/spec is missing, **proceed anyway** using the user request as the contract. Label anything you infer as **Inferred**.

## When to stop early (rare; prefer proceeding)

Only stop early (ask questions and wait) if implementing would require guessing **core behavior** or crossing a permission boundary:
- **Permission boundary**: touching third-party/vendor folders without explicit permission.
- **Authority unclear**: you cannot identify a single owner/decision point and would be guessing where behavior should live.
- **Ambiguous contract**: you cannot write observable acceptance checks without guessing user intent.

If you stop early or are interrupted, you MUST use the **Implementation status** block in the final report so it's unambiguous whether code changed.

## Required output shape (do not deviate)

Always produce:
- Gate 0 (contract extraction; short)
- Gate 1 (change map + authority; short)
- Gate 4 (final report; always)

If you are NOT stopping early, also produce:
- Gate 2 implementation (actual edits)
- Gate 3 validation record

**Do not paste large code diffs.** Prefer a "Changed files" list + behavioral description + where it lives (file + class/method names).

## Gate 0 — Contract (extract, don't rewrite)

Write:
- **Spec source**: link the plan/spec if provided (e.g., `docs/scratch/<name>.plan.md`) or mark **Inferred**.
- **Acceptance checks** (2–6): observable outcomes.
- **Non-goals** (0–3): what you will not change.

## Gate 1 — Authority + change map (fast preflight)

Write:
- **Owner**: single authority component for the behavior.
- **Decision point**: the method/function where the key decision is made.
- **Files to touch**: list.
- **Risks to watch** (1–4): only the highest-likelihood regressions (lifecycle/order, state ownership, boundary I/O, hot-path allocations, etc.).
  - Include “mode/fast-path mismatch” when the system has multiple execution modes (e.g., external dependency enabled vs disabled). Make sure validation and tests exercise the same mode/config as the reported issue (or force the failure deterministically with a boundary mock).

Then immediately start implementation (do not stall here).

## Gate 2 — Implement (do this)

Make the smallest set of edits that satisfy the acceptance checks.

Apply general best practices:
- Clean separation of concerns
- Proper error handling
- No circular dependencies
- Proper cleanup (event listeners, timers, subscriptions)

## Gate 3 — Validate (required if you implemented)

Record:
- **Tests run** (if any) and results.
- **Manual checks** (if any).
- **Acceptance checks**: verify each explicitly or mark as not verified.
- **Known gaps**: what you didn't validate and why.

## Gate 4 — Final report (required output)

Write:

- **Implementation status** (required; must be unambiguous):
  - **Status**: `Completed` | `Partial` | `Blocked (no implementation)` | `Interrupted (budget/timeout)`
  - **Stop reason** (required if not `Completed`): choose one, be specific:
    - `Ambiguous contract` (cannot write acceptance checks without guessing)
    - `Permission boundary` (would touch third-party/vendor without explicit permission)
    - `Authority unclear` (cannot identify single owner/decision point)
    - `Tooling/environment blocked` (cannot run required validation/tooling; state what failed)
    - `Budget/timeout` (you are intentionally stopping due to response budget constraints)
    - `Other` (explain)
  - **What is already done**: 1–8 bullets; include partial edits/validation already performed.
  - **What remains**: 1–12 bullets; ordered; specific enough to resume without re-planning.
  - **Continue-from-here handoff** (required if not `Completed`):
    - **Resume point**: e.g., "Resume at Gate 2, step 3: …" or "Resume at Gate 3: …"
    - **Next command to run** (if any) and expected result
    - **If you need user input**: ask the smallest set of blocking questions

- **Changed files**: list.
- **Acceptance checks**: each one, with how it was verified (or "not verified").
- **Verification record**
  - **Verified**: tests/manual scenarios exercised.
  - **Not verified**: anything not exercised, and why.
  - **Remaining risks**: 1–3 bullets (highest risk assumptions still unproven).

**Budget rule:** Never silently stop mid-implementation. If you are at risk of running out of response budget, stop at the end of a Gate boundary and use `Interrupted (budget/timeout)` with a precise handoff.
