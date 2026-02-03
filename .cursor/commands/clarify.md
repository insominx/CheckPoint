**Last Reviewed:** 2025-12-23

The user should have already provided a freeform description of what they want.

Your job is to close the highest-risk gaps so the intent becomes unambiguous and the next steps (especially `understand`, then `plan`) can proceed safely.

If you cannot make intent unambiguous because the user (or you) lacks domain vocabulary or key constraints, it is acceptable to run `understand` first to learn the landscape, then return to clarify.

Do not write any code yet.

## Hard constraints

- Ask at most **5** clarifying questions per round.
- Clarification can be repeated across multiple rounds.
- Prefer questions that unblock safe progress; avoid long interviews.
- If a question is already answered in the user's text, do not ask it again.

## Method

1. **Restate your understanding first** (short, concrete).
2. **Identify missing high-risk information** (only ask if unclear or missing):
   - Ambiguity (before/after behavior)
   - Scope boundaries (non-goals)
   - Authority (which source of truth wins)
   - Contracts/consumers (who might be broken)
   - Verification (how we will prove "done")
3. **Ask up to 5 questions**, prioritized by risk.
   - If there are more than 5 unknowns, group them and ask for the highest-leverage answers first.
4. **If the user can't answer**, propose explicit assumptions and call out the risk.
5. **End with a gate**: say whether you are unblocked to proceed.
   - If blocked due to missing domain/repo context: recommend `understand`, then return to `clarify`.
   - If blocked: explicitly say what you need answered.

## Output format (in chat)

- **My understanding**
  - Intent:
  - In scope:
  - Out of scope:
  - Success criteria:
- **Clarifying questions (max 5)**
- **Assumptions (if unanswered)**
- **Next step**
  - If unblocked: recommend `understand`.
    - Purpose: select the smallest useful subset of project docs to read next (and optionally record them under `docs/scratch/*.context.md`).
  - Then recommend `plan`.
    - Purpose: write a phased implementation plan under `docs/scratch/*.md` with a test/verification approach.
  - If blocked: explicitly say what you need answered.
