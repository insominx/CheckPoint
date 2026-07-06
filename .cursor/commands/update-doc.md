# update-doc

Your goal is to ensure the attached document is 100% accurate and up-to-date with the current codebase.

## Verification Steps
1. **Entity Verification**: For every class, method, variable, or file path mentioned in the document, you MUST verify it exists in the codebase.
   - Use search tools to perform these checks efficiently.
   - If a name is not found, assume it has been renamed or deleted. Search for the likely new name by looking for the concept or logic in the code.
   - Do not assume a name is correct just because it looks plausible. Verify it matches the actual code exactly.

2. **Claim Verification**: Cross-check every architectural claim or logic description against the actual code implementation.
   - If the doc says "X calls Y", verify that call exists in the code.
   - If the doc describes a data flow, trace it in the code.

3. **Update Content**:
   - Replace outdated names with current canonical names.
   - Update descriptions to match current logic.
   - Remove references to deleted files or features.
   - Ensure the document remains high-level (avoid pasting large code blocks).

## Guidelines
- **No Magic**: Do not guess. If you can't find it, flag it or find the new equivalent.
- **Code References**: Use backticks for code elements (e.g., `MyClass`).
- **Line Numbers**: Omit line numbers; they go stale.
