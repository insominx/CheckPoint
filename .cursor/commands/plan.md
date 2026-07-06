# plan

Goal: Write a high-signal, implementation-ready plan for the requested feature/fix, without writing any production code yet.

You should reference relevant files + classes + methods (and config files when relevant), but do not paste or write method bodies. This is framing + risk management, not implementation.

Constraints:
- Do not edit third-party/vendor folders unless explicitly instructed.
- Prefer the smallest viable change; avoid premature abstractions.

## Required inputs

- A clear user request (or a short restatement you infer from user text).
- Runtime context if relevant (browser vs server vs CLI vs tests).
- If available: the output of `/understand` or any existing context docs.

## File output (required)

If `docs/scratch/` does not exist, create it.

1) Determine `<plan_basename>` (kebab-case):
   - If the user mentions a plan path like `docs/scratch/<name>.plan.md`, use `<name>`.
   - Otherwise infer a short, stable name from the request (e.g., "add dark mode toggle" → `dark-mode-toggle`).

2) Create or overwrite:
   - `docs/scratch/<plan_basename>.plan.md`

3) The plan file MUST start with:
   - `Last Edited: <YYYY-MM-DD>`

## Plan structure (required)

Write the plan in this structure, with dense bullets (no filler):

1) **Contract**
   - Behavior bullets (2–5)
   - Non-goals (1–5)
   - Acceptance checks (2–8; observable outcomes)
   - Risk profile: correctness / performance / external integration (APIs/files/databases)

2) **Authority & state ownership**
   - Owner (single authority component) + decision point (method/function)
   - Dependency direction (Input → Domain → Infrastructure) + any new dependencies you would introduce (and why they are not circular)
   - Module/package boundary notes if the change crosses boundaries
   - State owners: source of truth vs cache vs persisted files
   - Persistence boundaries: what reads/writes disk/API/database; what must remain non-blocking

3) **Proposed approach (smallest viable change)**
   - Steps/phases (3–10), ordered, each with:
     - What changes, where it lives (file + symbol)
     - Why that is the correct authority location
   - Complexity avoided (1–3 bullets): what you will *not* build and why

4) **Impacted surfaces**
   - Files/symbols you expect to touch (group by subsystem: UI / domain / infra / tooling / tests / docs)
   - Config/data files and how they are referenced

5) **Edge cases & failure modes**
   - 5–10 cases, including:
     - Rapid interaction / reentrancy (if UI involved)
     - Persistence/boundary cases (files/APIs/databases)
     - Performance cliff (hot-path allocations, tight loops)
   - For at least 3 cases: intended failure mode (hard-fail vs recover) and user-visible effect

6) **Verification plan**
   - Tests to run (unit/integration/e2e) and the specific suites/categories if known
   - Minimal manual checks (include browser/device variations if UI)
   - What evidence proves each acceptance check

7) **Open questions / missing info**
   - Only questions that change the design or block safe implementation
   - Each question should include the decision it blocks
