# mine-git-history

Extract actionable learnings from a related project's Git history to inform your own project.

Goal: Prevent future failures by learning what other teams repeatedly broke and fixed.

## Input

Provide:
- **Source repo path**: Local path to the cloned repository to scan
- **Source repo name**: Short name for the output file (e.g., `react-query`, `prisma`)
- **Target project context**: What your project does and what learnings you're looking for
- **Domain keywords** (optional): Specific terms to search for in commit messages

## Deliverable

Create one markdown report at: `docs/external/<repo>-git-history-findings.md`

---

## Scanning Strategy

### Step A — Identify test/fixture directories

Search the tree for:
- `tests/`, `test/`, `__tests__/`, `spec/`, `regress/`
- `testdata/`, `fixtures/`, `samples/`, `corpus/`, `mocks/`
- `golden/`, `snapshots/`, `__snapshots__/`

The fastest learning comes from test cases added **because something broke**.

### Step B — Mine commits by keyword clusters

Use `git log --oneline --grep "<keyword>"` with clusters relevant to the domain.

**Universal bug-signal keywords:**
- `fix`, `bug`, `regression`, `revert`, `broke`, `crash`, `hang`, `leak`
- `flaky`, `intermittent`, `race`, `deadlock`, `timeout`
- `edge case`, `corner case`, `off by one`, `boundary`

**Determinism / consistency:**
- `deterministic`, `nondeterministic`, `flaky`, `random`, `seed`
- `order`, `sort`, `stable`, `hash`, `cache invalidation`

**State / lifecycle:**
- `state`, `lifecycle`, `init`, `cleanup`, `dispose`, `memory leak`
- `stale`, `orphan`, `dangling`, `zombie`

**Concurrency / async:**
- `race condition`, `deadlock`, `mutex`, `lock`, `atomic`
- `async`, `await`, `promise`, `callback`, `event loop`

**Parsing / serialization:**
- `parse`, `serialize`, `encode`, `decode`, `escape`, `unescape`
- `unicode`, `utf-8`, `encoding`, `malformed`, `truncate`

**Performance / resource:**
- `performance`, `slow`, `memory`, `allocation`, `pool`
- `batch`, `chunk`, `stream`, `buffer`, `overflow`

**Add domain-specific clusters** based on source repo and target project context.

### Step C — Extract 5 fields per interesting commit

1. **Symptom**: what broke (crash? wrong output? flaky test? performance?)
2. **Root cause**: the underlying bug pattern
3. **Fix pattern**: invariant enforced or logic changed
4. **Test added**: fixture, snapshot, or test case? Where?
5. **Config/flags**: environment variables, feature flags, tolerances

### Step D — Convert to action shapes

Every finding must become one of:
- **Requirement/guardrail**: new requirement, risk, or acceptance gate for your docs
- **Test case/fixture**: minimal reproduction to add to your test suite
- **Invariant**: rule to enforce in implementation (e.g., "always validate X before Y")
- **Config/harness rule**: environment settings, CI flags, test isolation

If it doesn't fit one of these, skip it.

---

## Red Flags (high-signal patterns)

Watch for these in commit history:
- **"fixed but reverted"** → high regression risk area
- **"platform-specific tests disabled"** → cross-platform determinism is hard
- **"retry/backoff added"** → flaky dependencies or race conditions
- **"cache invalidation"** → staleness bugs likely
- **"fallback behavior changed"** → edge cases around degraded modes
- **"resource cleanup"** → leak patterns

---

## Output Template

```markdown
# <Repo> Git History Analysis — Lessons for <Your Project>

## Executive summary
- (5–10 bullets max: highest-leverage risks and fix patterns)

## High-signal bug patterns

### <Category 1> (e.g., State Management)
- **Commit**: <hash or PR link>
  - Symptom:
  - Root cause:
  - Fix pattern:
  - Test added:
  - Config/flags:

### <Category 2> (e.g., Async/Concurrency)
...

## Recommended changes

### Requirements/docs
- **Where**: <doc path or section>
  - **Change**: ...
  - **Why**: ...

### Test cases to add
- **Test**: <path or description>
  - **Purpose**:
  - **What it catches**:

### Implementation invariants
- <invariant description> (learned from <commit>)

## Notes / limitations
- ...
```

---

## If No Findings

If a repo yields nothing actionable, state explicitly:
- Why the scope doesn't match
- Any partial learnings worth noting
