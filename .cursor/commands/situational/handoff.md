# handoff

Goal: Preserve the **highest-signal context** from the current session into a Markdown file that can bootstrap a *new agent* later (or let you resume after a context reset), without losing key decisions, constraints, or next steps.

## When to run
- The context window is getting full / you distrust quality.
- You are about to switch agents, switch branches, pause work, or hand off to a teammate.
- You want a durable "resume packet" that can be used as the next prompt's seed.

## Constraints (non-negotiable)
- **No code changes.** This is documentation only.
- **No large code dumps or diffs.** Prefer file + symbol pointers and short snippets only when absolutely necessary.
- **Every nontrivial claim must be anchored** to one of:
  - File path + symbol name (class/method/function), or
  - Config path + key, or
  - Test name + result, or
  - Command + output summary (e.g., `git status`, test run).
- If you are uncertain: write **Unknown** and what evidence would resolve it.

## File output (required)

If `docs/scratch/` does not exist, create it.

1) Determine `<handoff_basename>` (kebab-case):
   - If a related plan exists at `docs/scratch/<name>.plan.md`, use `<name>`.
   - Else if a related context file exists at `docs/scratch/<name>.context.md`, use `<name>`.
   - Otherwise infer a short stable name from the topic (e.g., "fix login form validation" → `fix-login-form-validation`).

2) Create or overwrite:
   - `docs/scratch/<handoff_basename>.handoff.md`

3) The file MUST start with:
   - `Last Edited: <YYYY-MM-DD>`

## Report structure (required)

Write the handoff in this exact structure, optimized for maximum information per token:

1) **TL;DR (10–20 lines max)**
   - What the user wants (1–3 bullets)
   - What is done (1–5 bullets)
   - What remains (1–8 bullets)
   - Biggest risks/unknowns (1–5 bullets)

2) **Contract**
   - **Spec source**: link the plan/spec if present (e.g., `docs/scratch/<name>.plan.md`), otherwise label as **Inferred**.
   - **Acceptance checks** (2–8): observable outcomes that prove "done".
   - **Non-goals** (0–5)

3) **Current status snapshot**
   - **Branch / commit** (if known)
   - **Change set**: changed files list (paths only; no diffs)
   - **Runtime mode(s)** involved: browser / server / CLI / tests
   - **Repro steps** (if debugging): minimal, deterministic steps

4) **System map (only what matters to resume)**
   - **Owner**: the single authority component for the behavior
   - **Decision point(s)**: method(s)/function(s) where key decisions happen
   - **Key flows (3–7)**: each as a short bullet flow diagram
   - **State ownership**: source of truth vs cache vs persisted state
   - **Persistence / boundary I/O**: files/JSON/APIs/databases (only if relevant)

5) **What was learned (high signal only)**
   - 5–15 bullets, each with:
     - **Observation**
     - **Why it matters**
     - **Anchor** (path + symbol / config ref / test)

6) **Decisions & rationale**
   - 3–12 bullets:
     - Decision
     - Alternatives considered (optional)
     - Rationale
     - Anchor(s)

7) **Verification record**
   - **Tests run** (names + pass/fail)
   - **Manual checks** (scenarios + results)
   - **Not verified** (explicit list + why)

8) **Open questions (blockers only)**
   - Each question must include:
     - What decision it blocks
     - Where to look next (file/doc pointers)

9) **Resume recipe (copy/paste friendly)**
   - **Starting point**: "Resume at <Gate/step> …"
   - **Next 3 actions**: specific and ordered (e.g., run `/understand` on topic X, then `/plan`, then `/implement`)
   - **Expected evidence** after each action (what you expect to see/change)

## Quality bar checklist (self-check before saving)
- Does a new agent have enough to proceed **without re-reading the entire repo**?
- Can they locate the authority and decision point in under 2 minutes?
- Are acceptance checks concrete and verifiable?
- Are unknowns explicitly labeled with the evidence needed?
- Is the doc dense (mostly bullets), with minimal narrative?
