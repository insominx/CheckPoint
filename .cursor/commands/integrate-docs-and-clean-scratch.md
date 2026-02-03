# integrate-docs-and-clean-scratch

Your goal is to **integrate** useful information from `docs/scratch/` into the project’s **long-term documentation**, then **delete** the scratch artifacts once they are fully superseded.

This command is for the common workflow after implementing a feature/fix and updating docs: consolidate plans, deep-dives, and scratch notes into stable system docs and remove redundant scratch files.

## Process assumptions (important)

- `docs/scratch/` is **ephemeral** and intentionally not indexed; it should not accumulate long-term truth.
- This workflow must be **scoped to the current task only**. Do not clean up unrelated scratch work.
- Long-term homes (project-dependent; prefer existing conventions in the repo):
  - **System/architecture notes**: `docs/architecture/`, `docs/systems/`, or a top-level `docs/architecture.md`
  - **Design/contracts/specs**: `docs/design/`, `docs/technical-design.md`, or a task/spec doc under `docs/`
  - **Runbooks/how-tos**: `docs/runbooks/`, `docs/operations/`, or a `docs/testing-and-validation.md`
  - **Decisions**: `docs/adr/` (or `docs/ADR/`)

## Scope guardrails (do not violate)

You MUST define the scratch scope before touching or deleting anything:

- **Scope keywords**: a short list of keywords/ids for the task (examples: `["auth", "pagination", "cache", "migration", "api"]`).
- **Explicit scratch allowlist (preferred)**: an explicit list of scratch file paths you are allowed to consider.

Rules:
- Only include scratch files that match **(a)** the explicit allowlist OR **(b)** the scope keywords in filename/content.
- Never delete a scratch file unless it is in the **explicit delete allowlist** for this run.
- If the user did not provide an explicit delete allowlist, treat Gate 3 as “propose deletions” only (no deletes).

## When to stop early

Stop early only if:
- you cannot determine the intended “owner” doc for a chunk of information without guessing, OR
- the scratch content references files/paths that don’t exist and you can’t find their modern equivalent.

If you stop early, produce a short handoff: which scratch file + section is ambiguous and which candidate destination docs you considered.

## Required output shape (do not deviate)

Always produce:
- Gate 0 (inventory + extraction plan; short)
- Gate 1 (destination map + dedupe decisions; short)
- Gate 2 (integration edits)
- Gate 3 (cleanup + verification)
- Gate 4 (final report)

Do not paste large diffs. Prefer changed-files lists + concise descriptions.

## Gate 0 — Inventory (fast)

Write:
- **Scope**: what topic(s) you’re consolidating (e.g., “auth retries + logs + error taxonomy”).
- **Scope keywords**: the keyword list you are using to decide what is in/out.
- **Allowlists**:
  - **Scratch allowlist** (files you will inspect)
  - **Delete allowlist** (files you will delete if safe)
- **Scratch inventory**: list the scratch files you will consider (paths under `docs/scratch/`).
- **Extraction candidates**: 3–10 bullets of the *kinds* of info you expect to extract (e.g., semantics, invariants, validation commands, fixture mapping, pitfalls, evidence).

Then immediately start Gate 1.

## Gate 1 — Destination map + dedupe decisions

Write:
- **Authority doc(s)**: the single best long-term home(s) for each info type.
  - Example mapping:
    - semantics + warning codes → `docs/systems/<topic>.md`
    - “how to run / reproduce / validate” → `docs/testing-and-validation.md` or `docs/user-manual.md`
    - “why we chose X” → `docs/adr/<adr>.md`
    - “current implementation status” → `docs/systems/implementation-status.md`
- **Keep vs delete rules**
  - Keep scratch files only if they contain:
    - raw exploration logs that still have ongoing value, AND
    - they are referenced by an indexed/stable doc as an appendix
  - Otherwise: extract → integrate → delete.

## Gate 2 — Integrate (do this)

### A) Extract unique information

For each scratch file:
- Identify **unique** content that is not already in stable docs.
- Classify it into one of:
  - **Normative**: “this is how the system works / should work”
  - **Operational**: commands, runbooks, troubleshooting
  - **Evidence**: results, measurements, known-good runs (include dates + paths)
  - **Risks/footguns**: failure modes, pitfalls, limits/caps
  - **Future work**: explicitly labeled non-goals / next steps

### B) Write to the correct stable doc

Apply these rules:
- **No magic**: verify any referenced symbol/file path exists; if renamed, update to canonical name.
- **Prefer stable, minimal language**: don’t embed scratch chronology in system docs.
- **Preserve key constraints**: include guardrails like “read-only probes”, “depth limits”, “warn-only policy”, etc.
- **Make it actionable**: include “what to do when you see it” and “how to reproduce” where appropriate.
- **Avoid duplication**: if the info now exists in a stable doc, remove the duplicated statement from other docs or replace with a pointer.

### C) Update cross-references

Search for links to scratch files and update them to:
- point to the new stable location, or
- remove the link if it no longer adds value.

## Gate 3 — Cleanup + verification

### A) Cleanup

Delete scratch files **only after**:
- all unique content is integrated into stable docs, AND
- no files in the repo reference the scratch file paths anymore.

Additional safety rules:
- Only delete files that are in the **delete allowlist**.
- If a file looks related by keyword match but is not in the delete allowlist, leave it in place and include it under “Proposed deletions (not executed)” in Gate 4.

### B) Verification checks

- Run a repo-wide search for the deleted scratch filenames (must be zero references).
- Re-skim the updated stable docs to ensure they are:
  - accurate
  - internally consistent (no “today means…” contradictions)
  - aligned with actual code behavior

## Gate 4 — Final report

Write:
- **Status**: `Completed` | `Partial` | `Blocked`
- **Integrated topics**: 3–8 bullets (what got moved where).
- **Deleted scratch files**: list.
- **Changed stable docs**: list.
- **Reference check**: confirm no remaining links to deleted scratch docs.
- **Remaining follow-ups** (if any): short list.

