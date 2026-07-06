# understand

Goal: Become expert-level on everything in this project that materially affects the current topic,
such that you can (a) explain it, (b) debug it, and (c) identify safe change locations.

Hard stop condition (must satisfy ALL):
- Can name the 3–7 load-bearing flows and trace each end-to-end (control + data + lifecycle timing).
- Can identify: state owner(s), update authority, persistence boundary, and invariants for each flow.
- Can point to the "right change locations" for each flow (files + symbols), without changing anything.
- Can list top failure modes, blast radius, and how tests cover or fail to cover them.
- Every nontrivial claim is anchored to a file path + symbol (or config ref).

Constraints:
- Do NOT write code, modify files, or change the repo.
- You MAY read documentation, source code, tests, configs, and build/deploy scripts.

Sequence:

PASS 0 — Frame the topic
1) Classify the topic:
   - Frontend / Backend / Full-stack / Tooling
   - Performance-sensitive / correctness-critical / lifecycle-order-sensitive (if applicable)
2) Name likely artifacts and boundaries involved:
   - Which project root(s) are in scope
   - Config files, data files, external dependencies, build outputs
   - Module/package boundaries and any public API surfaces
3) Write 2–4 scope bullets:
   - What is included/excluded in "topic"
   - What you are explicitly NOT trying to answer yet
4) Candidate entry points (narrow, not single):
   - Identify 2–4 most likely entry points for this topic total.
   - For each, include: file/symbol, why it is likely, confidence (High/Med/Low).

PASS 1 — Orientation (docs-first, local docs are authoritative)
5) Start with README.md and any existing documentation, follow only the most relevant branches.
5a) Do a quick docs triage:
   - Write **Must-read docs (minimal set)** (aim 3–7) and **Nice-to-have docs** (0–5).
   - Include a 1-line reason for each doc (why it matters to the topic).
   - If you considered docs but intentionally skipped them, list **Not included but considered** (1–5) with a brief reason.
   - Then actually read the Must-read set before moving on to code.

Docs discovery rule:
- Prefer documentation over code until you can name the intended architecture, authority, and invariants for the topic.
- If the topic terms are unclear, use targeted search within docs (not the whole repo) to find the best starting doc(s).
6) Produce a short Topic Map (high signal, not a paraphrase):
   - Key terms and project-specific definitions
   - Intended behavior and stated architecture
   - Source of truth per claim (doc vs code vs config)
   - State owner(s) and update authority (who decides, who writes)
   - Invariants/guarantees, constraints, non-goals
   - Failure blast radius (what breaks if wrong)
   - Contradictions, TODOs, missing pieces
7) Use pointers (don't read everything):
   - Reference existing guides, architecture docs, or implementation notes if they exist.

PASS 2 — Recon (where to look in code)
8) Dependency map first (fast):
   - List relevant modules/packages and their reference edges (who depends on whom).
   - If packages/libraries are involved, identify public API surfaces.
9) Identify 3–7 load-bearing flows for this topic (entry points + critical paths).
   Entry points examples:
   - Application boot / initialization
   - Event handling and interaction authority (who "wins" when multiple handlers compete)
   - UI event wiring (button callbacks, state management, selection state)
   - Config-driven behavior (environment variables, config files, feature flags)
   - Persistence boundaries (files, databases, APIs, localStorage)
   - Build/deploy hooks (if applicable)
10) For each flow, list the "spine" artifacts:
   - Spine files/symbols (paths + key classes/methods/functions)
   - Which module/package owns the code
   - Which configs are involved and where referenced

Scope gate (anti-drift, mandatory before deep dives):
- Restate the scope bullets.
- List any scope creep discovered so far.
- Reject creep unless it blocks satisfying the hard stop condition.

Depth selection rule ("jaggedness"):
- Go deep on code that is: lifecycle-order-sensitive, hot path, correctness-critical,
  allocation-heavy, async/event-driven, configuration-driven, or frequently changed.
- Stay shallow on glue code, wrappers, and leaf utilities unless they hide complexity.

PASS 3 — Jagged deep dives (deep where it matters)
11) For each load-bearing flow, go DEEP:
   - Trace control flow end-to-end (include lifecycle timing assumptions)
   - Trace data flow (core structures, schemas, state transitions, persisted vs working state)
   - Identify state owner and update authority (who can mutate what, when)
   - Note decisions, edge cases, error handling, retries/timeouts (if applicable)
   - Call out invariants that gate correctness
   - Identify extension points and the "right" change locations (without changing anything)
   - Cross-reference tests validating behavior (or note missing tests)
12) For surrounding context, stay SHALLOW:
   - Adjacent modules and what they contribute
   - Interfaces/contracts that matter for the deep dives

PASS 4 — Synthesis (write the artifact)
Deliverable:
- Save a Markdown report to: `docs/scratch/understand-<topic>.md`
- Replace `<topic>` with a kebab-case slug describing the topic (e.g., `understand-data-flow.md`).
- Create `docs/scratch/` if it does not exist.

Report structure (required, density constraints apply):
0) Top 5 facts, Top 5 risks (each with file path + symbol anchor)
1) Scope & assumptions (what "topic" includes/excludes)
2) Relevant docs index (paths + 1–2 line summaries)
   - Include your **Must-read** vs **Nice-to-have** split (from step 5a).
3) Dependency map (modules and package boundaries)
4) System overview (components and responsibilities; state owners + update authority)
5) Config/artifacts involved (config files, data files, environment variables) + where referenced
6) Load-bearing flows (3–7), each:
   - Text flow diagram
   - Entry point(s) (initialization / UI events / API calls)
   - Key files and symbols
   - Deep dive notes (control flow + data flow + lifecycle timing)
   - State owner(s) + update authority
   - Invariants and ordering constraints
   - Edge cases & failure modes + blast radius
   - Tests and coverage notes
7) Key data models / schemas / state machines
8) Configuration and environment dependencies (packages, env vars, external services)
9) Gotchas and footguns (especially async timing and state management pitfalls)
10) Open questions (with exact file/doc locations, and what decision each blocks)
11) Quick glossary (project-specific meanings)

Report density rules:
- Prefer bullets over paragraphs.
- Avoid filler. If you cannot anchor a claim to a path/symbol or config ref, mark it as Unknown.
- Keep each flow section to what is needed to satisfy the hard stop condition.

If anything is unclear:
- Try to resolve it by reading docs/code/configs first.
- Then ask targeted questions only if it blocks the hard stop condition.
  Each question must include: exact file path, short snippet, and the decision it blocks.
