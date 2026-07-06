# review-plan-fix-high-severity-loop
#
# Purpose: Iteratively tighten a *plan/spec/PRD* by (a) reviewing it, (b) fixing the **high severity** issues,
# and (c) re-reviewing until no high severity issues remain.
#
# This is a "review → edit → review" loop intended to make the plan safe to implement.
#
# Constraints
- Do **not** write or modify code unless the user explicitly asks.
- Prefer **concrete references** over generic advice: cite plan sections, intended flows, and known repo constraints.
- Only fix issues by editing the **plan/spec document(s)** (and closely related supporting docs) unless the user asks for implementation.

## Required inputs (ask for what's missing)
- The **plan/spec** to process (e.g. `docs/scratch/<name>.plan.md`, a PRD like `docs/*.md`, or a pasted plan summary).
- Optional but recommended: the plan’s **acceptance checks** (observable outcomes that prove the plan is done).

If acceptance checks are missing, propose a minimal set, clearly labeled as **proposed**.

## Severity rubric (use this consistently)
- **High severity**: likely to cause the wrong thing to be built, create an untestable plan, introduce a correctness/lifecycle hazard, or block initial implementation. These must be fixed in-doc before stopping.
- **Medium severity**: important quality/clarity improvements that reduce risk but do not block implementation.
- **Low severity**: nits, style, minor consistency, optional polish.

## Looping workflow (repeat until exit condition met)

### Step A — Review (use the `/review-plan` gates)
Perform a plan review using the `/review-plan` gate structure:
1. **Restated contract**
2. **Strengths**
3. **Risks / concerns** (ranked)
4. **Questions & missing info**
5. **Suggested plan edits** (specific wording/structure changes; no code)
6. **Verification outline**

### Step B — Extract the **High severity** items
From the review, produce a dedicated section:
- **High severity issues (must fix now)**: 1–10 bullets, each with:
  - **Where**: section heading(s) and/or line ranges if available
  - **Why it matters**: 1–2 sentences
  - **Doc fix**: the exact wording/structure change you will make

If there are **no** high severity issues, skip to **Exit condition**.

### Step C — Apply fixes (edit docs)
Edit the plan/spec document(s) to resolve every high severity issue:
- Prefer the **smallest** wording/structure change that removes ambiguity or inconsistency.
- Make requirements internally consistent (examples must match requirements).
- If you introduce new definitions (e.g., metrics/tolerances), ensure they are referenced from acceptance checks.

### Step D — Re-review
Re-run Step A on the updated document(s), and repeat the loop.

## Exit condition (required)
Stop only when:
- **High severity issues = 0**, and
- Any remaining medium/low items are either fixed or explicitly deferred with rationale.

## Output format (required each loop iteration)
Respond in Markdown with this structure:
1. **Review (current iteration)**
2. **High severity issues (must fix now)** (may be “none”)
3. **Edits applied** (list of doc edits made this iteration)
4. **Remaining medium/low items** (brief)
5. **Loop status** (continue vs done)

