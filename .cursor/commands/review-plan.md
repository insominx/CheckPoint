# review-plan
#
# Purpose: Review a *plan or design proposal* (pre-implementation) for quality, risk, and clarity.
# You are not the decider; produce analysis that helps the human decide whether to proceed.
#
# Constraints
- Do **not** write or modify code unless the user explicitly asks.
- Prefer **concrete references** over generic advice: cite plan sections, intended flows, and known repo constraints.

## Required inputs (ask for what's missing)
- The **plan/spec** to review (e.g. `docs/scratch/<name>.plan.md`) or a pasted plan summary.
- Optional but strongly recommended: **acceptance checks** (observable outcomes that prove the plan is done).

If acceptance checks are missing, ask for them and/or propose a minimal set, clearly labeled as **proposed**.

## Review Gates (do in order; write notes as you go)

### Gate 0 — Restate the contract you think the plan implies
Write:
- **User-visible behavior** (2–5 bullets)
- **Non-goals** (1–5 bullets)
- **Acceptance checks** (2–8 bullets; observable, not "code is clean")
- **Risk profile**: correctness-critical / performance-sensitive / external-integration (APIs/files/databases)

If you had to infer any of this, label it as **inferred**.

### Gate 1 — Scope, assumptions, and missing info
Check:
- Are assumptions explicit (async timing, threading expectations, browser compatibility)?
- Are boundaries named (files/APIs/databases, external services)?
- What information is missing that could change the design?

Write:
- **Missing inputs** (questions that block confident review)
- **Ambiguities** (places two interpretations exist)

### Gate 2 — Architecture & responsibilities (design quality)
Evaluate:
- **Responsibilities & soundness**: cohesive components, clear authority, separation of concerns
- **Simplicity**: smallest reasonable design; avoid premature abstraction
- **Dependencies & coupling**: Input → Domain → Infrastructure direction; avoid cycles and authority duplication

Call out likely "load-bearing" components and where decisions should live.

### Gate 3 — Invariants & lifecycle hazards
Look for plan-level red flags:
- Reliance on fragile initialization ordering for cross-component wiring
- Event subscription/unsubscription strategy missing (double-sub risk, memory leaks)
- State ownership unclear (source of truth vs derived/cache/persisted)
- UI state management plans missing a single refresh authority / intent queueing rules

### Gate 4 — Verification strategy (is the plan testable?)
Assess:
- What automated tests should catch regressions (unit/integration/e2e)?
- What minimal manual scenarios are required (rapid interaction, edge cases)?
- What evidence would demonstrate acceptance checks are met?

If tests don't exist, recommend the smallest high-value test(s) that would catch the most likely regression.

### Gate 5 — Risks, alternatives, and "make it safer"
Write:
- **Top risks** (ranked; include why they matter)
- **Mitigations** (specific structural/naming/authority choices)
- **Simplifications** (what to avoid adding; what can be deferred)
- **Fallback plan** (what to do if the approach fails late)

## Output format (required)
Respond in Markdown with this structure:

1. **Restated contract**
2. **Strengths**
3. **Risks / concerns** (ranked)
4. **Questions & missing info**
5. **Suggested plan edits** (specific wording/structure changes; no code)
6. **Verification outline** (tests + minimal manual checks + evidence)
