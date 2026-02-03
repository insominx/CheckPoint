# Class Deletion (Local Cascade)

This document defines the local-only class deletion behavior and its safety constraints.

## Behavior (normative)
- **Hard delete** a class by `classId` so it no longer appears in the Home dropdown.
- **Cascade delete** all per-class data in IndexedDB:
  - `classes`, `students`, `sessions`, `ledger`, `settings`
- **Remove** the draft session cache from `localStorage` using key `checkpoint_draft_session_<classId>`.
- **If the deleted class was selected**, clear selection and reset session state so navigation becomes disabled and `/session` redirects to `/`.

## Authority and entry points
- **Authority**: Zustand store action `deleteClass(classId)` in `web/src/store.ts`.
- **UI entry**: Home page delete control in `web/src/pages/Home.tsx`.

## Safety and guardrails
- Perform the cascade in a **Dexie write transaction** to avoid partial deletes.
- Confirmation must include **class name + classId** (identity before I/O).
- Confirmation must state:
  - this is irreversible locally
  - this **does not** delete any Google Sheet or Drive file
- Disable the delete control while the operation is running.

## Non-goals
- No remote deletion of Google Sheets / Drive files.
- No archive/unarchive or separate “Manage Classes” page.

## Edge cases to handle
- **Selected class deletion**: clear `selectedClassId`, `currentSession`, and reset `currentN` to default.
- **Draft session present**: remove `checkpoint_draft_session_<classId>` so it cannot be restored.
- **Linked spreadsheetId**: delete the `settings` row so the spreadsheetId can be reused by another class.

## Verification (manual)
1. Create two classes, import roster into class A, run and save a session.
2. Set a `spreadsheetId` in Settings for class A.
3. Delete class A from Home.
4. Verify:
   - Class A no longer appears in Home dropdown (no reload required).
   - IndexedDB has no rows for class A in `students`, `sessions`, `ledger`, `settings`, or `classes`.
   - `localStorage.getItem('checkpoint_draft_session_' + classId)` is `null`.
   - You can reuse class A’s spreadsheetId for class B without a uniqueness conflict.
5. While on `/session` with class A selected, delete class A and confirm redirect to `/`.

## Related code
- `web/src/store.ts` — `deleteClass`, `updateClassSettings`
- `web/src/pages/Home.tsx` — delete action UI and confirmation copy
