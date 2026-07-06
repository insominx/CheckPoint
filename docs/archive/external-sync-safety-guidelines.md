Last Edited: 2026-02-03

# External Sync Safety Guidelines

Agent-facing rules for integrating with an external, user-editable data store (e.g., a spreadsheet, document DB, or shared file) where **schema drift** and **wrong-target operations** are the dominant risks.

## Core principle: Identity before I/O

- **Always establish “what remote is this?” before any destructive action.**
  - Remote identity must be **explicit** (a stable scope key like `datasetId` / `classId` / `tenantId`), not inferred from titles.
  - Validate identity **before** you clear/overwrite/import into local state.

- **Fail closed by default.**
  - If identity can’t be verified, block destructive operations.
  - Provide a separate, explicit **repair/migration** path to bring legacy remotes up to the current identity contract.

## Define a minimal remote contract (schema + version)

- **Version the remote schema.**
  - Keep a `schemaVersion` field in remote metadata.
  - Use versioning to support migrations and safe parsing over time.

- **Keep identity metadata in a single, canonical place.**
  - Prefer a dedicated metadata row or section containing:
    - scope key (e.g., `classId`)
    - human label (e.g., `className`) for user-facing mismatch messages
    - `schemaVersion`
    - last sync timestamp (for conflict warnings)

- **Align what you write with what you document.**
  - If you add a new written column (e.g., `lastExportedAt`), update the declared header/contract at the same time.
  - Never silently “append new columns” without updating the contract.

## Parsing rules for user-editable remotes

External stores are frequently edited by humans; your reader must be defensive.

- **Treat headers as data hazards.**
  - Be robust to:
    - duplicated header rows inside the body
    - reordered columns
    - missing columns
    - extra columns
  - Use a **header index** (key → column index) rather than positional assumptions.

- **Normalize all “key” cells before comparison.**
  - Trim whitespace; normalize casing for header keys.
  - Avoid false positives like interpreting the literal string `classId` as an actual ID value.

- **Handle multi-scope remotes explicitly.**
  - If a remote contains multiple scope keys and your app is single-scope-per-remote, treat it as **unsupported** and block destructive operations.
  - If you intend multi-scope support, design it upfront (explicit scoping + filtering on every tab/table).

## Safe operations policy (block / warn / allow)

Adopt a clear policy table. Example:

- **Identity match**: allow open/export/import.
- **Identity missing (legacy)**:
  - allow **read-only** open with a warning
  - allow export only if it writes repaired metadata
  - block destructive import until repaired
- **Identity mismatch**: block open/export/import by default; show both identities; require explicit override only if absolutely necessary.
- **Multiple identities**: block; require user to choose a supported format (or implement multi-scope support).

## UI guardrails (reduce operator error)

- **Always show the active scope context** next to remote actions.
  - Display both a human label and the stable key.

- **Name actions by risk.**
  - “Import (overwrite)” should be visibly destructive.
  - “Repair metadata” should be separate from “Sync”.

- **Make remote structure discoverable.**
  - If the remote has multiple tabs/tables, provide a short note: “Roster exports to the Students tab”, etc.

## Observability: separate “warnings” from “failures”

- Some browser console warnings are environmental and not actionable (e.g., cross-origin popup policy warnings during OAuth).
  - **Don’t treat them as functional failures** unless your flow actually breaks.
  - Prefer showing actionable, domain-level messages (identity mismatch, missing scope key, schema version unsupported).

## Implementation checklist (fast)

- **Before coding**
  - Identify the authority that decides “safe to overwrite/import?”
  - Write acceptance checks for mismatch, legacy, and multi-identity cases.

- **While coding**
  - Add a single “probe identity” function used by every remote action.
  - Add a “repair/migrate metadata” action for legacy remotes.
  - Ensure all destructive operations validate identity **before** any local deletion or remote clearing.

- **After coding**
  - Manually test with:
    - correct remote
    - wrong remote (mismatch)
    - legacy remote (missing metadata)
    - remote with duplicated header rows
