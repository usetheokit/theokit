# Plan: Security Hardening — Fix All 23 Vulnerabilities from Security Review

> **Version 1.1** (2026-06-10) — Absorbed 4 edge cases from
> [`reviews/security-hardening-edge-cases-2026-06-10.md`](../reviews/security-hardening-edge-cases-2026-06-10.md).
> **1 MUST FIX:** EC-1 (SHELL_METACHARS missing `>`, `<`, `\n`, `\r` — redirect
> and newline injection bypass). **2 SHOULD TEST:** EC-2 (null byte in file path),
> EC-3 (LRU eviction order assertion). **1 DOCUMENT:** EC-4 (picomatch as devDep
> acceptable while sandbox is decorator-only).
>
> **Version 1.0** (2026-06-10) — Corrigir todas as vulnerabilidades encontradas no security review (`code-review-output/final_report.md`): sandbox bypass (path traversal + command injection + ReDoS), information disclosure (LLM errors + HTTP 500), budget enforcement (mid-stream abort), API key redaction, session bounds, tool arg validation, e documentação de segurança.

## Goal

> Fix all 9 HIGH and 11 MEDIUM security vulnerabilities in the agent sandbox, LLM runner, orchestrator, and TheoApp so that no path traversal, command injection, or information disclosure is exploitable, measured by 25+ new security-focused tests GREEN and zero HIGH findings in a re-run of the security review.

## Context

Security review (2026-06-10) found 23 vulnerabilities across 4 files. The critical cluster is the **sandbox bypass** (path traversal + command injection) — this is the trust boundary between LLM and host system. Second cluster is **information disclosure** (LLM error bodies + HTTP 500 messages leaked to clients).

Positive: session encryption (AES-GCM-256), CSRF multi-layer, webhook timing-safe, TOTP constant-time are all FAANG-grade — no changes needed there.

**Rules:** `architecture.md` (agents/ depends on http-decorators, not vice versa), `testing.md` (TDD, bug-fix tasks need regression test first), `type-safety.md` (no `any`).

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/agents/src/decorators/sandbox.ts` | 120 | `8ca8411` (2026-06-10) | Sandbox config for code agents | `isPathAllowed`, `isCommandAllowed`, `matchGlob` public API |
| `packages/agents/src/bridge/llm-runner.ts` | 182 | `264449e` (2026-06-10) | Real LLM runner with OpenRouter | `createRealAgentStream()` signature, session Map |
| `packages/agents/src/bridge/agent-orchestrator.ts` | 133 | `2643eac` (2026-06-10) | Multi-agent delegation | `delegate()` signature, `DelegateOptions` |
| `packages/http-decorators/src/app.ts` | 480 | `2643eac` (2026-06-10) | TheoApp bootstrap | `handleRequest()`, `TheoAppOptions` |
| `packages/agents/tests/unit/sandbox-security.test.ts` (NEW) | 0 | — | Sandbox security tests | — |
| `packages/agents/tests/unit/llm-runner-security.test.ts` (NEW) | 0 | — | LLM runner security tests | — |

### Current callers

- `isPathAllowed()`, `isCommandAllowed()` — called by agent runtime (not in production yet, decorator-only)
- `createRealAgentStream()` — called by `TheoApp.autoWireAgents()` and `delegate()`
- `delegate()` — exported from `@theokit/agents` barrel
- `handleRequest()` — internal to TheoApp (node adapter callback)

### Domain glossary

- **Path traversal** — `../` sequences escaping an allow/deny sandbox
- **Command injection** — shell metacharacters (`;`, `&&`, `|`) after an allowed command prefix
- **ReDoS** — Regular Expression Denial of Service via catastrophic backtracking
- **Information disclosure** — leaking internal error details to untrusted clients
- **Mid-stream abort** — cancelling an LLM stream when budget threshold is hit

### Architecture boundaries

All changes within `packages/agents/` and `packages/http-decorators/` — no cross-package boundary changes. `picomatch` already a dep in `packages/theo/`; add to `packages/agents/` as devDep for sandbox.

## Prior Art & Related Work

- **OWASP Path Traversal** — canonical guidance: normalize then validate
- **OWASP Command Injection** — parse, don't pattern-match; deny shell metacharacters
- **picomatch** — already in `packages/theo/package.json:114`; battle-tested glob matcher
- **Node.js `path.resolve()`** — normalizes `../` sequences

## Objective

- [ ] Fix sandbox path traversal (normalize with `path.resolve`)
- [ ] Fix sandbox command injection (tokenize + metachar deny)
- [ ] Replace homebrew glob with `picomatch`
- [ ] Scrub LLM error responses (generic message to client, full error to console)
- [ ] Scrub HTTP 500 error messages
- [ ] Add mid-stream budget enforcement in orchestrator
- [ ] Add session Map size cap (LRU eviction)
- [ ] Validate tool arguments with Zod schema before handler
- [ ] Log swallowed SSE parse errors
- [ ] Document `new Function()` security justification
- [ ] Validate health endpoint paths don't collide with user routes

## ADRs

### D1 — Use picomatch for glob matching (not homebrew regex)

**Decision:** Replace `matchGlob()` in sandbox.ts with `picomatch`. Already a dep in the monorepo.

**Rationale:** Homebrew glob→regex has ReDoS risk and incomplete escaping. `picomatch` is battle-tested (200M weekly downloads), handles all edge cases. Per Princípio 9 (Não Reinvente a Roda).

**Alternatives:** minimatch — rejected: heavier, slower, picomatch already in monorepo.

### D2 — Error scrubbing at boundary (not deep in call stack)

**Decision:** Scrub error messages at the two system boundaries: (a) SSE event yield in llm-runner, (b) HTTP response in TheoApp catch block. Log full error server-side.

**Rationale:** Per Princípio 8 (Error Handling) — validate at boundaries. Deep scrubbing adds complexity without benefit. Two `if` statements at the boundary suffice.

**Alternatives:** Global error middleware — rejected: TheoApp doesn't have a middleware chain for internal errors; an `if` at the catch block is KISS.

### D3 — Command tokenization (not shell parsing)

**Decision:** Split command on first whitespace to extract the binary name. Deny if the binary isn't in the allow list. Additionally, reject commands containing shell metacharacters (`;`, `&&`, `||`, `|`, `$()`, `` ` ``).

**Rationale:** Full shell parsing (e.g., `shell-quote`) is over-engineering. Tokenize + metachar deny catches 99% of injection vectors. Per KISS.

**Alternatives:** `shell-quote` library — rejected: adds dependency for a 5-line check; the deny-list of metacharacters is sufficient.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| picomatch adds a runtime dep to agents package | Low | Already in monorepo; tree-shakeable; ~5KB | Dev |
| Mid-stream budget abort may leave partial SSE streams | Medium | Emit `error` event before aborting; client handles gracefully | Dev |
| Session LRU eviction may drop active conversations | Medium | Set cap high (10000); evict oldest only | Dev |

## Unresolved Questions

(none — all fixes are well-defined with established patterns)

## Dependency Graph

```
Phase 1 (Sandbox) ──┐
Phase 2 (LLM Runner) ──┤──▶ Phase 4 (Integration)
Phase 3 (App + Orchestrator) ──┘
```

Phases 1-3 can parallelize (different files). Phase 4 validates all.

---

## Phase 1: Sandbox Security Fixes

**Objective:** Eliminate path traversal, command injection, and ReDoS in sandbox.ts.

### T1.1 — Fix all 3 sandbox vulnerabilities

#### Objective
Fix path traversal (`isPathAllowed`), command injection (`isCommandAllowed`), and ReDoS (`matchGlob`) in one task since they're all in the same 120-line file.

#### Why this step

**Action:** (a) Normalize file paths with `path.resolve('/', filePath).slice(1)` before matching. (b) Replace `startsWith()` command matching with tokenize-first-word + metachar deny. (c) Replace `matchGlob()` with `picomatch`.

**Reasoning:** These 3 vulnerabilities form a single trust boundary (the sandbox). Fixing them together ensures the boundary is secure as a unit. Per D1 (picomatch) and D3 (tokenization).

#### Evidence
- `sandbox.ts:82-95` — `isPathAllowed` uses raw `filePath` without normalization
- `sandbox.ts:102-108` — `isCommandAllowed` uses `startsWith()` prefix matching
- `sandbox.ts:112-118` — `matchGlob` builds regex from pattern without proper escaping

#### Files to edit
```
packages/agents/src/decorators/sandbox.ts — fix isPathAllowed, isCommandAllowed, replace matchGlob
packages/agents/package.json — add picomatch devDep
packages/agents/tests/unit/sandbox-security.test.ts (NEW) — security regression tests
```

#### Deep file dependency analysis
- `sandbox.ts` (120 LoC) — `isPathAllowed` and `isCommandAllowed` are exported but not called in production code yet (decorator-only, runtime integration pending). Safe to change signature internals.
- `matchGlob` is private (not exported). Replacing with picomatch is internal.

#### Pseudo-code

```typescript
// Path traversal fix
import { resolve } from 'node:path'
export function isPathAllowed(sandbox: SandboxOptions, filePath: string, operation: 'read' | 'write'): boolean {
  if (filePath.includes('\x00')) return false // EC-2: null byte injection
  const normalized = resolve('/', filePath).slice(1) // removes ../ sequences
  // ... rest uses normalized instead of filePath
}

// Command injection fix
const SHELL_METACHARS = /[;|&$`(){}<>\n\r]/  // EC-1: includes redirect operators + newlines
export function isCommandAllowed(sandbox: SandboxOptions, command: string): boolean {
  if (SHELL_METACHARS.test(command)) return false // deny shell metacharacters
  const binary = command.split(/\s+/)[0] // first token = binary name
  if (cmds.deny?.some((d) => binary === d || command.startsWith(d + ' '))) return false
  return cmds.allow.some((a) => binary === a || command.startsWith(a + ' '))
}

// matchGlob replacement
import picomatch from 'picomatch'
function matchGlob(pattern: string, path: string): boolean {
  return picomatch(pattern)(path)
}
```

#### Tasks
1. Add `picomatch` as devDep to `packages/agents/package.json`
2. Fix `isPathAllowed` — normalize with `path.resolve('/', filePath).slice(1)`
3. Fix `isCommandAllowed` — add `SHELL_METACHARS` deny + tokenize binary name
4. Replace `matchGlob` body with `picomatch(pattern)(path)`
5. Write security regression tests

#### TDD
```
RED:   test_path_traversal_blocked() — isPathAllowed(deny:['.env'], 'src/../.env') returns false
RED:   test_path_traversal_normalized() — isPathAllowed(allow:['src/**'], 'src/../.env') returns false
RED:   test_command_injection_semicolon() — isCommandAllowed(allow:['npm'], 'npm test; rm -rf /') returns false
RED:   test_command_injection_pipe() — isCommandAllowed(allow:['npm'], 'npm test | cat /etc/passwd') returns false
RED:   test_command_injection_ampersand() — isCommandAllowed(allow:['npm'], 'npm test && evil') returns false
RED:   test_command_injection_backtick() — isCommandAllowed(allow:['npm'], 'npm `evil`') returns false
RED:   test_command_injection_redirect() — (EC-1) isCommandAllowed(allow:['npm'], 'npm test > /tmp/exfil') returns false
RED:   test_command_injection_newline() — (EC-1) isCommandAllowed(allow:['npm'], 'npm test\nevil') returns false
RED:   test_command_allowed_clean() — isCommandAllowed(allow:['npm'], 'npm test') returns true
RED:   test_path_null_byte_blocked() — (EC-2) isPathAllowed(allow:['src/**'], 'src/\x00.env') returns false
RED:   test_glob_no_redos() — matchGlob with complex pattern completes in <10ms
RED:   test_glob_basic_star() — matchGlob('src/*.ts', 'src/foo.ts') returns true
RED:   test_glob_double_star() — matchGlob('src/**', 'src/a/b/c.ts') returns true
GREEN: Implement all 3 fixes
VERIFY: cd packages/agents && npx vitest run tests/unit/sandbox-security.test.ts
```

#### Concurrency tests
(none — single-threaded pure functions)

#### Acceptance Criteria
- [ ] `src/../.env` blocked by path normalization
- [ ] Shell metacharacters (`;`, `|`, `&&`, `$()`, `` ` ``) blocked
- [ ] `picomatch` used instead of homebrew regex
- [ ] 10+ security tests GREEN
- [ ] Pass: lint, size ≤ 500 LoC

#### DoD
- [ ] Tests pass — `npx vitest run tests/unit/sandbox-security.test.ts`
- [ ] Existing sandbox tests still pass

---

## Phase 2: LLM Runner Security Fixes

**Objective:** Fix information disclosure, session bounds, parse error logging, and tool arg validation.

### T2.1 — Fix all 4 llm-runner vulnerabilities

#### Objective
Scrub LLM errors, cap session store, log parse failures, validate tool args.

#### Why this step

**Action:** (a) Replace raw error text with generic message at L100. (b) Add MAX_SESSIONS=10000 with LRU eviction. (c) Add `console.warn` for parse errors at L134. (d) Add `schema.safeParse()` before tool handler at L149.

**Reasoning:** Per D2 (boundary scrubbing) — the SSE yield is the system boundary. Per Princípio 8 (fail-fast) — validate tool args before calling handler. Session cap prevents OOM DoS.

#### Evidence
- `llm-runner.ts:100` — `yield { type: 'error', message: \`OpenRouter ${res.status}: ${await res.text()}\` }`
- `llm-runner.ts:38` — `const sessions = new Map<string, Session>()` — unbounded
- `llm-runner.ts:134` — `catch { /* EC-1: skip malformed */ }` — silent
- `llm-runner.ts:149` — `tool.handler(JSON.parse(tc.function.arguments || '{}'))` — no validation

#### Files to edit
```
packages/agents/src/bridge/llm-runner.ts — fix 4 vulnerabilities
packages/agents/tests/unit/llm-runner-security.test.ts (NEW) — security tests
```

#### Pseudo-code

```typescript
// (a) Error scrubbing at L100
yield { type: 'error', code: 'LLM_ERROR', message: `LLM request failed (${res.status})`, retryable: res.status === 429 }
console.error(`[theokit:agents] OpenRouter ${res.status}:`, await res.text())

// (b) Session cap
const MAX_SESSIONS = 10_000
function getOrCreateSession(sessionId: string): Session {
  let s = sessions.get(sessionId)
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (oldest) sessions.delete(oldest) // LRU: Map preserves insertion order
    }
    s = { messages: [], createdAt: Date.now(), totalCostUsd: 0 }
    sessions.set(sessionId, s)
  }
  return s
}

// (c) Parse error logging at L134
catch (parseErr) { console.warn('[theokit:agents] Malformed SSE chunk skipped:', parseErr instanceof Error ? parseErr.message : 'unknown') }

// (d) Tool arg validation
const parsed = tool.inputSchema?.safeParse?.(JSON.parse(tc.function.arguments || '{}'))
if (parsed && !parsed.success) {
  yield { type: 'tool_result', callId: tc.id, toolName: orig, output: 'Invalid tool arguments', durationMs: 0, isError: true }
  continue
}
const input = parsed?.data ?? JSON.parse(tc.function.arguments || '{}')
const r = await tool.handler(input)
```

#### Tasks
1. Replace error message at L100 with generic text + console.error
2. Add MAX_SESSIONS constant and LRU eviction in session creation
3. Replace empty catch at L134 with console.warn
4. Add safeParse validation before tool handler call

#### TDD
```
RED:   test_llm_error_scrubbed() — mock fetch returning 500, assert SSE event message does NOT contain response body
RED:   test_session_cap_evicts_oldest() — (EC-3) create sessions 'a','b','c' at cap, add 'd', assert 'a' evicted (Map insertion order)
RED:   test_parse_error_logged() — malformed SSE chunk produces console.warn (spy)
RED:   test_tool_args_validated() — invalid tool args → isError:true response without calling handler
RED:   test_tool_args_valid_passes() — valid args → handler called normally
GREEN: Implement all 4 fixes
VERIFY: cd packages/agents && npx vitest run tests/unit/llm-runner-security.test.ts
```

#### Concurrency tests
(none — single-threaded async generator)

#### Acceptance Criteria
- [ ] LLM error bodies never reach SSE clients
- [ ] Session store capped at 10000
- [ ] Parse errors logged (not silenced)
- [ ] Tool args validated against schema before handler
- [ ] 5+ security tests GREEN

#### DoD
- [ ] Tests pass
- [ ] Existing tests still pass (194 total)

---

## Phase 3: TheoApp + Orchestrator Security Fixes

**Objective:** Fix error disclosure in app.ts, document new Function, add mid-stream budget, validate health paths.

### T3.1 — Fix app.ts error disclosure + document new Function

#### Objective
Scrub 500 error messages and add security comment for new Function.

#### Why this step

**Action:** (a) Replace `err.message` in catch block with `"Internal Server Error"` + console.error. (b) Add security justification comment above `new Function` line. (c) Validate health paths don't start with `/api/` (collision guard).

**Reasoning:** Per D2 (boundary scrubbing). The `new Function()` pattern is safe because it's called with a hardcoded string — but it needs documentation to prevent copy-paste misuse.

#### Files to edit
```
packages/http-decorators/src/app.ts — fix error scrubbing + document new Function + path validation
```

#### Tasks
1. Replace `err.message` at catch block with generic message + console.error
2. Add `// SECURITY: new Function used for dynamic import of optional peer dep. Argument is HARDCODED, never user input.` comment
3. Add path collision check for health/ready paths in constructor

#### TDD
```
RED:   test_500_error_scrubbed() — handler throws Error('secret'), response body does NOT contain 'secret'
RED:   test_health_path_collision_rejected() — healthPath='/api/users' throws in create()
GREEN: Implement fixes
VERIFY: cd packages/http-decorators && npx vitest run
```

#### Acceptance Criteria
- [ ] 500 responses never contain raw error messages
- [ ] `new Function` has security justification comment
- [ ] Health paths starting with `/api/` rejected

### T3.2 — Add mid-stream budget enforcement to orchestrator

#### Objective
Abort sub-agent stream when accumulated cost exceeds budget.

#### Files to edit
```
packages/agents/src/bridge/agent-orchestrator.ts — add per-event cost accumulation + abort
```

#### Tasks
1. Track accumulated cost during stream consumption
2. When cost exceeds budget, break from stream loop and throw BudgetExceededError
3. Add security comment about API key handling

#### TDD
```
RED:   test_budget_abort_mid_stream() — mock stream yielding done with cost > budget, assert BudgetExceededError thrown before full consumption
GREEN: Implement mid-stream check
VERIFY: cd packages/agents && npx vitest run tests/unit/agent-orchestrator.test.ts
```

#### Acceptance Criteria
- [ ] Budget checked after each `done` event (not only at end)
- [ ] Stream aborted on budget exceeded

---

## Phase 4: Integration Validation (MANDATORY)

### Execution

```bash
turbo run build --filter='./packages/*' --force
turbo run test --filter='./packages/*'
npx tsc --noEmit
```

### Acceptance Criteria

- [ ] All tests GREEN (existing 403 + 25+ new security tests)
- [ ] Zero type errors
- [ ] Zero HIGH findings on security re-review of fixed files
- [ ] No raw error messages in any HTTP response or SSE event

---

## Coverage Matrix

| # | Vulnerability | Task | Resolution |
|---|---|---|---|
| 1 | Path traversal sandbox.ts:79 | T1.1 | path.resolve normalization |
| 2 | Command injection sandbox.ts:100 | T1.1 | tokenize + metachar deny |
| 3 | ReDoS sandbox.ts:113 | T1.1 | picomatch replaces homebrew |
| 4 | LLM error leaked llm-runner.ts:98 | T2.1 | generic message + console.error |
| 5 | HTTP 500 leaked app.ts:419 | T3.1 | generic "Internal Server Error" |
| 6 | Post-hoc budget orchestrator.ts:128 | T3.2 | mid-stream cost check |
| 7 | API key plaintext orchestrator.ts:68 | T3.2 | security comment (accepted risk for v1) |
| 8 | Unbounded sessions llm-runner.ts:34 | T2.1 | MAX_SESSIONS=10000 + LRU |
| 9 | Swallowed parse errors llm-runner.ts:134 | T2.1 | console.warn |
| 10 | Unvalidated tool args llm-runner.ts:152 | T2.1 | safeParse before handler |
| 11 | new Function eval app.ts:184 | T3.1 | security justification comment |
| 12 | Health path collision app.ts:312 | T3.1 | reject /api/* paths |

**Coverage: 12/12 vulnerabilities covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] 403+ existing tests GREEN
- [ ] 25+ new security tests GREEN
- [ ] Zero type errors
- [ ] Zero lint warnings on changed files
- [ ] CHANGELOG.md updated under `[Unreleased] § Security`
- [ ] No raw error messages reach clients in any code path

## Failure scenarios

(none — no external I/O touched. All changes are input validation, error scrubbing, and configuration. LLM API calls are pre-existing.)
