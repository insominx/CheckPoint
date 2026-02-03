# Web Development Testing Guidelines

General principles for writing reliable web tests (unit, integration, E2E) that catch real issues without being fragile. These are framework-focused, not project-specific.

## Test Integrity: Never Mask Problems

**When a test fails, fix the underlying issue, not the test.**

A failing test is a signal. Weakening assertions to silence it hides bugs and defeats the purpose of testing.

### Rules

1. **Do not relax or broaden assertions to make failures pass.**  
   If a test expects `3` rendered items and you got `4`, figure out why. Don’t change it to “>= 3”.

2. **Do not delete or skip tests that expose real issues.**  
   “Flaky” often means “non-deterministic code” or “bad test isolation”. Fix that.

3. **Fix the root cause, not the symptom.**  
   If a test fails because order changed, determine whether:
   - the app behavior is wrong (fix the app), or
   - the expectation was wrong (fix the test with a clear rationale).

4. **Preserve invariant tests as guardrails.**  
   Auth boundaries, input validation, error handling, accessibility checks, and security invariants should stay strict.

5. **Add coverage for new behavior instead of weakening existing checks.**  
   If you add a new UI state, add a new test. Don’t dilute the original one.

6. **Remove diagnostic scaffolding after fixing.**  
   Temporary sleeps, retries, extra logging, and “looser” assertions should not be permanent.

### Anti-Patterns

```ts
// ❌ Broadening an assertion to pass
expect(items.length).toBeGreaterThanOrEqual(1); // was: toBe(3)

// ❌ Swallowing failures
try { await doThing(); } catch { /* ignore */ }

// ❌ Commenting out an assertion
// expect(result.ok).toBe(true)

// ❌ “Fixing” expected values blindly
expect(total).toBe(4); // was 3, changed to make test pass
```

### Correct Approach

```ts
// ✅ Keep strict contracts strict
expect(items).toHaveLength(3); // Contract: exactly 3 items expected

// ✅ Add a new test for the new path, keep original strict
test("OriginalBehavior_StillWorks", () => {/* strict assertion */});
test("NewEdgeCase_HandledCorrectly", () => {/* new assertion */});
```

## Choose the Right Test Type

- **Unit tests**: pure functions, utilities, reducers, validation, formatting, domain rules.
- **Component tests** (React/Vue/etc.): rendering, state transitions, event handlers, accessibility, minimal mocks.
- **Integration tests**: multiple modules working together (API client + cache + components), in-memory DB, mocked network.
- **E2E tests** (Playwright/Cypress): critical user journeys, auth flows, routing, real browser behavior.

Rule of thumb: **test as low as possible, as high as necessary**. Most bugs are caught with unit/component tests; E2E is for “this must never break” paths.

## Isolate External Dependencies

- **Do not hit real networks** in unit/integration tests. Mock at the boundary:
  - browser: `fetch`/XHR
  - Node: HTTP client module
- Prefer **dependency injection** (pass a client) over global singletons.
- Avoid shared mutable globals (process env, global caches) without resetting.

Good pattern:
- business logic depends on an interface like `ApiClient`
- tests provide a fake client with deterministic responses

## Control Time, Randomness, and Concurrency

- **Freeze time** for tests involving dates/timeouts.
  - Jest/Vitest fake timers where appropriate.
- Seed randomness or avoid randomness entirely in tests.
- Avoid “wait 2 seconds” assertions. Assert **state**, not **time**.
- For async UI: wait for **the condition**, not the clock:
  - “wait until button enabled”
  - “wait until request finished”

## Network Mocking: Make It Deterministic

- Prefer **contract-like** mocks:
  - explicit request match (method + URL + body)
  - explicit response payload
- Use one of:
  - MSW (mock service worker) for browser-like tests
  - fetch-mock / nock (Node) for server-side
- Ensure tests fail on **unexpected requests**. Surprise traffic is a bug.

## DOM and UI Tests: Assert What Users Perceive

- Prefer queries by **role/label/text** over class names.
  - `getByRole('button', { name: /save/i })` beats `.btn-primary`
- Avoid asserting internal component structure.
- Accessibility is not optional:
  - labels, roles, focus behavior, keyboard nav where it matters

## E2E Reliability (Playwright/Cypress)

- Keep E2E small: smoke tests + core flows.
- Make E2E independent:
  - reset database/state between tests (seed fixtures)
  - unique test users
- Don’t rely on timing:
  - wait for navigation, network idle, element visibility, specific state
- Use stable selectors intentionally:
  - `data-testid` for elements that have no user-facing semantics
  - don’t overuse it when roles/labels exist

## Environment and State: Prevent “It Works On My Machine”

Web tests commonly fail due to environment drift. Make tests hermetic.

### Common Environment Issues

| Source | What Changes | How It Breaks Tests |
|---|---|---|
| `.env` / CI secrets | base URLs, feature flags | requests go to wrong place, UI differs |
| LocalStorage/Cookies | auth tokens, experiments | tests start “logged in” or wrong variant |
| Service Workers | cached assets/API | stale UI/data, phantom responses |
| Timezone/Locale | date formatting | snapshots and date expectations fail |
| Browser differences | fonts/layout | flaky visual and pixel assertions |

### Hard Rules

- Clear storage between tests (localStorage/sessionStorage/cookies).
- Don’t depend on developer machine timezone/locale.
- Disable or control service workers in test runs.
- In CI, run against the same Node/browser versions you develop on.

## Snapshots: Use Sparingly and Intentionally

Snapshots are easy to create and easy to abuse.

- ✅ Good for: stable, small outputs (HTML fragments, JSON transforms).
- ❌ Bad for: whole pages, large trees, frequently changing UI.

If a snapshot changes often, it’s noise, not coverage. Replace with targeted assertions.

## Logging, Errors, and Observability

- Treat console errors/warnings as test failures unless explicitly expected.
- In frontend tests, fail on unexpected `console.error`.
- Prefer returning structured error objects over logging and continuing.
- If you must test errors, assert them explicitly (message + type + boundary behavior).

## Test Hygiene Checklist

- Arrange only what you need.
- Act on the smallest surface area.
- Assert minimal, meaningful outcomes.
- Name tests by intent: `Method_Condition_Outcome`.
- Reset globals, mocks, and environment between tests.
- No shared state between tests.
- **When fixing a failing test:** fix the root cause. Never weaken assertions, skip tests, or mask failures to make CI green.

## Practical Defaults (Good Starting Stack)

- Unit/Component: **Vitest or Jest** + **Testing Library**
- Network mocking: **MSW**
- E2E: **Playwright**
- Linting: ESLint + TypeScript rules
- Formatting: Prettier
- CI: run tests with locked Node version, headless browser, deterministic env vars
