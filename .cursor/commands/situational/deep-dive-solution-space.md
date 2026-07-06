# deep-dive-solution-space

Goal: Produce a *deeper-than-usual* exploration of a specific problem, generating a **corpus of thinking** (many approaches, including “outside the box”) and compiling it into a new Markdown file under `docs/scratch/`.

This command is for situations where the user is explicitly asking for:
- more possibilities, not just “the best” solution
- edge cases and failure modes
- pros/cons and trade-offs
- synthesis “in totality” (how the issue interacts with the whole pipeline/system)

## Constraints
- You MAY read project docs, code, tests, and artifacts as needed to ground the analysis.
- You MAY create a new Markdown file under `docs/scratch/` (and only there).
- Do NOT modify production code, tests, or configs unless the user explicitly asks.
- Do NOT weaken acceptance criteria. This output is an analysis artifact, not an implementation.
- Anchor nontrivial claims to file paths/symbols or doc paths where possible.

## Required inputs
- **Problem statement**: 2–10 sentences describing the issue and why it matters.
- **Context docs**: 1–5 doc paths to read first (the user can @-mention them).
- Optional: PRD/spec and current status docs (recommended if available).

## Output (required)
1) Determine `<topic_slug>` (kebab-case).
2) Create a new Markdown file:
   - `docs/scratch/deep-dive-<topic_slug>-solution-space.md`
3) The file MUST begin with:
   - `Last Edited: <YYYY-MM-DD>`
   - `Topic: <short title>`
   - `Inputs: <list the doc paths and key code paths consulted>`

## Required report structure

### 0) Executive synthesis (dense)
- 3–7 bullets: what’s actually happening, why it’s hard, what’s at risk
- 3–7 bullets: what we know vs what we don’t know yet (label Unknown explicitly)

### 1) Problem definition + scope boundaries
- What is “in scope” and “out of scope”
- Definitions/glossary for project-specific terms
- Observable symptoms and how they would manifest (drift, crashes, incorrect output, nondeterminism, etc.)

### 2) Current state (ground truth)
- What the system does today (detection/handling/policy), with file/symbol anchors
- Where the issue is detected/emitted and how it surfaces (reports, warnings, status, etc.)
- Prevalence/impact evidence if available (fixtures, corpus summaries, known failing inputs)

### 3) Edge-case taxonomy (must be explicit)
- Enumerate edge cases as named bullets (EC1…ECn)
- Include at least:
  - structural vs semantic ambiguity cases
  - mutation/coupling “blast radius” cases
  - tool/library-behavior pitfalls (caching, identity, normalization, repair)
  - “opens but weird” vs “won’t open / needs repair” regimes

### 4) Solution space (the corpus)
Provide a **large option set**. Minimum 10 options unless the topic is truly narrow.

For each option:
- **Idea**
- **What it changes (and where)** (paths/symbols or subsystem-level)
- **Pros**
- **Cons**
- **Failure modes / risks**
- **Phase fit**: MVP vs later phases (or “acceptance vs best-effort” if applicable)

Include both conservative and unconventional approaches, such as:
- improved detection semantics and instrumentation
- reporting/schema changes to reduce noise + increase actionability
- defensive copy-on-write / mutation containment
- canonicalization/repair strategies (internal or external toolchain)
- consumer-aligned semantics strategies (when “external truth” is the target)
- policy changes gated by measured hazard levels

### 5) Trade-off matrix (forced clarity)
- A table comparing the top candidate options across:
  - complexity, semantics risk, determinism risk, blast radius risk, MVP compatibility, debuggability, testability

### 6) Diagnostics & evidence plan (make it falsifiable)
- Propose concrete artifacts/metrics that would let us *prove* which regime we’re in
- Include at least one “fast probe” (cheap, high-signal) and one “deep probe” (more work, more certainty)
- If useful, propose an on-disk JSON artifact schema and where it would be emitted

### 7) Hazard scoring + policy mapping
- Define hazard classes (what conditions actually matter)
- Map hazard classes to mode/policy outcomes (warn vs fail vs mitigate-first)
- Call out which mitigations reduce hazard level vs merely re-label it

### 8) Minimal experiments to choose direction
- 3–8 experiments, each with:
  - setup, expected signal, what decision it enables
  - what would falsify the hypothesis

### 9) “MVP honest” framing (no overcommitment)
- Recommend a sequencing that prioritizes safety + observability first
- Explicitly separate: “what we can do now” vs “what needs more evidence”

## Style and density rules
- Prefer bullets over paragraphs.
- Do not paste large code blocks.
- Use backticks for code identifiers and paths.
- If you can’t anchor a claim, mark it **Unknown** and propose how to measure it.

