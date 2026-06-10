---
slug: theokit-dogfood-bugs-fix
created_at: 2026-06-10
goal: Fix all 8 bugs found in the dogfood test so that a dev external to the monorepo can npx create-theokit, npm install, bun app.ts, and use controllers + agents + frontend without any manual workaround, measured by re-running the 29-test dogfood plan with 25/25 functional tests PASS.
---

# Plan: Fix 8 Dogfood Bugs

> **Version 1.1** (2026-06-10) — Absorbed EC-1 (publish order: packages as 0.1.0 stable BEFORE template, template uses ^0.1.0), EC-2 (actionable error message for missing API key), EC-3 (verify Symbol.for key consistency across packages), EC-4 (document inline HTML ≠ React SSR).
>
> **Version 1.0** — Fix all 8 bugs discovered during live dogfood testing. Three blockers (#2 version ranges, #4 guards on agents, #5 no built-in stream factory), three medium (#3 NotFoundException→500, #6 tool schemas, #8 frontend not served), two low (#1 dot name, #7 field naming).

## Goal

> Fix all 8 dogfood bugs so that `npx create-theokit my-app && cd my-app && npm install && bun app.ts` works end-to-end without manual workarounds, measured by re-running the 29-test dogfood checklist with 25/25 functional tests PASS.

## Context

Live dogfood (2026-06-10) found 8 bugs. The controller layer works well (CRUD, Zod, guards, 403/422). The agent layer is broken: no built-in LLM stream factory (#5), guards ignored on agents (#4), tool schemas arrive incomplete at the LLM (#6). The template has version range issues (#2) and the frontend is not served (#8).

## Baseline Context

### Files that will be touched

| File | LoC | Why | Invariants |
|---|---|---|---|
| `packages/create-theo/templates/default/package.json.tmpl` | 18 | Template manifest | Fix version ranges |
| `packages/create-theo/src/index.ts` | ~200 | Scaffolder CLI | Fix dot name validation |
| `packages/http-decorators/src/app.ts` | ~280 | TheoApp.create() | Fix guards on agents, serve frontend, NotFoundException |
| `packages/agents/src/bridge/llm-runner.ts` (NEW) | 0 | Built-in OpenRouter stream factory | Move from fixture to package |
| `packages/agents/src/bridge/agent-sse-handler.ts` | 55 | SSE handler | Already OK |
| `packages/agents/src/index.ts` | 15 | Barrel | Export llm-runner |

### Architecture boundaries affected

- `@theokit/agents` gains a built-in LLM runner (new file in bridge/)
- `@theokit/http-decorators` TheoApp gains frontend serving + guard enforcement on agent routes

## Prior Art & Related Work

- **Internal:** `fixtures/demo-faang/server/llm-agent-runner.ts` — the working LLM runner to promote to package code
- **External:** Vercel AI SDK — built-in OpenAI/Anthropic stream adapters shipped in the package, not left to the consumer

## Objective

- [ ] Bug #1: `create-theokit .` accepts dot as current directory name
- [ ] Bug #2: Template version ranges resolve prerelease versions
- [ ] Bug #3: NotFoundException caught by TheoApp error handler → 404
- [ ] Bug #4: @UseGuards enforced on agent routes (same pipeline)
- [ ] Bug #5: Built-in OpenRouter stream factory in @theokit/agents
- [ ] Bug #6: Zod→JSON Schema produces complete schemas for tools
- [ ] Bug #7: Tool field naming matches Zod schema (taskId not id)
- [ ] Bug #8: TheoApp serves frontend HTML at GET /

## ADRs

### D500 — LLM runner moves from fixture to @theokit/agents package

**Decision:** Move `llm-agent-runner.ts` from `fixtures/demo-faang/server/` to `packages/agents/src/bridge/llm-runner.ts` as a first-class export. TheoApp.create() imports it from `@theokit/agents` when agents[] is provided and OPENROUTER_API_KEY is set.

**Rationale:** Bug #5 exists because the LLM runner was a fixture file, not a package export. The consumer should never need to write a stream factory — the framework provides one. Per Rule 9 (Don't Reinvent the Wheel) the consumer shouldn't reimplement LLM streaming.

**Alternatives considered:**
- (a) Keep in fixture, document manual wiring — rejected: this IS the gap that makes the framework amateur.

**Consequences:** @theokit/agents gains a runtime dependency concept on `fetch()` (Web Standard, already available). OpenRouter URL is hardcoded but configurable via env var.

### D501 — TheoApp enforces guards on agent routes

**Decision:** Agent routes pass through the same guard pipeline as controller routes. The `autoWireAgents()` method reads `@UseGuards` metadata from the agent class and runs guards before forwarding to the LLM stream.

**Rationale:** Bug #4 is a security failure. Guards are the core value proposition of the shared pipeline. If they don't work on agents, the "same pipeline" claim is false.

**Alternatives considered:**
- (a) Guards only on controllers — rejected: breaks the framework's core promise.

**Consequences:** Every agent request goes through guard evaluation. ~1ms overhead per request.

### D502 — TheoApp serves static HTML for frontend

**Decision:** When `app/page.tsx` or `app/layout.tsx` exist in the project, TheoApp serves a bundled HTML response at `GET /`. For the template, the HTML is inlined in the entry file.

**Rationale:** Bug #8 — "full-stack" means backend + frontend. Without serving the frontend, it's only backend.

**Alternatives considered:**
- (a) Require Vite plugin — rejected: adds complexity for the default template. Vite is for advanced usage.

**Consequences:** Template `app.ts` includes inline HTML. Production apps use Vite plugin for React SSR.

## Drawbacks & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| LLM runner hardcodes OpenRouter URL | Low | Configurable via OPENROUTER_BASE_URL env var |
| Inline HTML in template is not React SSR | Low | Template README documents: "For React SSR, add Vite plugin" |
| Guard enforcement adds latency to agent requests | Low | ~1ms — acceptable |
| EC-4: Inline HTML ≠ React SSR — app/page.tsx is template structure, not rendered | Low | Document in README: "Frontend is inline HTML for alpha. For React SSR, add theokit Vite plugin." |

## Unresolved Questions

(none — every bug has a clear fix)

## Dependency Graph

```
Phase 1 (Blockers: #2, #5, #4) — sequential, each depends on previous
  ↓
Phase 2 (Medium: #3, #6, #8) — can parallelize
  ↓
Phase 3 (Low: #1, #7) — independent
  ↓
Phase 4 (Re-publish + re-dogfood)
```

---

## Phase 1: Blockers

### T1.1 — Bug #2: Fix template version ranges

#### Objective
Change `^0.1.0` to `0.1.0-alpha.0` for prerelease packages.

#### Why this step
**Action:** npm semver `^0.1.0` does NOT match `0.1.0-alpha.0` — prereleases require exact match.
**Reasoning:** This is why npm install fails for every new user. BLOCKER.

#### Files to edit
```
packages/create-theo/templates/default/package.json.tmpl — fix version ranges
```

#### TDD
```
RED:     npm install in fresh dir with ^0.1.0 fails
GREEN:   Change to exact prerelease versions
VERIFY:  npm install resolves all packages
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `npm install` in a fresh project resolves all @theokit/* packages
- [ ] `node_modules/@theokit/http-decorators` exists after install
- [ ] `node_modules/@theokit/agents` exists after install

#### DoD
- [ ] Fresh npm install works

### T1.2 — Bug #5: Built-in LLM stream factory

#### Objective
Move `llm-agent-runner.ts` from fixture to `@theokit/agents` package as `bridge/llm-runner.ts`.

#### Why this step
**Action:** Per D500, the framework ships a working LLM runner. Consumer writes zero stream wiring.
**Reasoning:** BLOCKER — without this, agents return AGENT_NOT_WIRED for every user.

#### Files to edit
```
packages/agents/src/bridge/llm-runner.ts (NEW) — moved from fixtures/demo-faang/server/llm-agent-runner.ts
packages/agents/src/bridge/index.ts — export createRealAgentStream
packages/agents/src/index.ts — re-export
packages/http-decorators/src/app.ts — import from @theokit/agents instead of fixture
```

#### TDD
```
RED:     TheoApp.create({ agents: [Agent] }) with OPENROUTER_API_KEY returns SSE stream
RED:     EC-2: Without OPENROUTER_API_KEY, error message includes env var name AND llmApiKey option
GREEN:   Move runner, wire import, actionable error message
VERIFY:  curl POST /api/agents/assistant/chat returns SSE events
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] `import { createRealAgentStream } from '@theokit/agents'` works
- [ ] TheoApp.create() auto-detects OPENROUTER_API_KEY and wires stream factory
- [ ] SSE stream returns run_started, tool_call, text_delta, done events

#### DoD
- [ ] Agent SSE works without manual wiring

### T1.3 — Bug #4: Guards enforced on agent routes

#### Objective
Agent routes pass through @UseGuards pipeline before reaching the LLM.

#### Why this step
**Action:** Per D501, read guard metadata from @Agent class and enforce during agent request handling.
**Reasoning:** BLOCKER security — without this, any unauthenticated request reaches the LLM.

#### Files to edit
```
packages/http-decorators/src/app.ts — add guard enforcement in agent route handler
```

#### TDD
```
RED:     POST /api/agents/assistant/chat without x-role header returns 403
GREEN:   Add guard check before forwarding to stream
VERIFY:  curl without auth → 403, curl with auth → SSE stream
```

#### Concurrency tests
(none — single-threaded)

#### Acceptance Criteria
- [ ] Agent request without required role → 403 Forbidden
- [ ] Agent request with required role → SSE stream
- [ ] EC-3: Guard metadata key `Symbol.for('theokit:http-decorators:use-guards')` consistent across packages
- [ ] Same RolesGuard works on controllers AND agents

#### DoD
- [ ] Security test passes

---

## Phase 2: Medium Bugs

### T2.1 — Bug #3: NotFoundException → 404 (not 500)

#### Objective
TheoApp error handler catches HttpException subclasses and returns their status code.

#### Files to edit
```
packages/http-decorators/src/app.ts — fix catch block in handleRequest
```

#### TDD
```
RED:     GET /api/tasks/999 returns 500
GREEN:   Check instanceof HttpException in catch, return ex.statusCode
VERIFY:  GET /api/tasks/999 returns 404
```

#### Acceptance Criteria
- [ ] NotFoundException → 404 with message
- [ ] ForbiddenException → 403
- [ ] Generic Error → 500

#### DoD
- [ ] 404 test passes

### T2.2 — Bug #6: Complete Zod→JSON Schema for tools

#### Objective
Fix the Zod→JSON Schema converter to produce complete `required` and `properties` for all tool input schemas.

#### Files to edit
```
packages/agents/src/bridge/llm-runner.ts — fix convertZodToJsonSchema (already moved in T1.2)
```

#### TDD
```
RED:     Tool with z.object({ title: z.string(), priority: z.enum([...]) }) produces schema with both properties
GREEN:   Fix converter to handle all Zod types correctly
VERIFY:  LLM receives complete schema and fills all fields
```

#### Acceptance Criteria
- [ ] z.string() → { type: "string" }
- [ ] z.number() → { type: "number" }
- [ ] z.enum(['a','b']) → { type: "string", enum: ["a","b"] }
- [ ] z.object nested → recursive properties
- [ ] required array includes non-optional fields

#### DoD
- [ ] All 7 tools have complete schemas

### T2.3 — Bug #8: TheoApp serves frontend HTML

#### Objective
TheoApp serves inline HTML at GET / so the template works full-stack out of the box.

#### Files to edit
```
packages/create-theo/templates/default/app.ts — add inline HTML serving
```

#### TDD
```
RED:     GET / returns 404
GREEN:   Add HTML response for GET /
VERIFY:  Browser shows UI at http://localhost:3000
```

#### Acceptance Criteria
- [ ] GET / returns 200 with text/html
- [ ] Browser shows task list + AI chat
- [ ] API routes still work (/api/tasks, /api/agents/assistant/chat)

#### DoD
- [ ] Browser UI loads

---

## Phase 3: Low Bugs

### T3.1 — Bug #1: create-theokit accepts `.` as name

#### Files to edit
```
packages/create-theo/src/index.ts — handle . as current directory
```

#### Acceptance Criteria
- [ ] `npx create-theokit .` uses current directory name as project name

#### DoD
- [ ] Scaffold in current dir works

### T3.2 — Bug #7: Tool field naming consistency

#### Files to edit
```
packages/create-theo/templates/default/server/toolboxes/task.tools.ts — ensure field names match
```

#### Acceptance Criteria
- [ ] tasks.complete input uses `taskId` (matches store API)
- [ ] LLM sends `taskId` (not `id`)

#### DoD
- [ ] Tool creates/completes with correct fields

---

## Phase 4: Re-publish + Re-dogfood

### T4.1 — Rebuild, re-publish, re-test

#### Objective
Publish fixed versions and re-run the full 29-test dogfood.

#### Tasks (EC-1: publish order — packages BEFORE template)
1. Bump @theokit/http-decorators to 0.1.0 (stable, not prerelease)
2. Bump @theokit/agents to 0.1.0 (stable, not prerelease)
3. npm publish BOTH packages first (stable versions on npm)
4. Update template package.json.tmpl to use ^0.1.0 (resolves stable 0.1.0)
5. Bump create-theokit to 0.5.1
6. npm publish create-theokit AFTER packages are live
5. Re-run dogfood in fresh /tmp directory
6. All 25 functional tests PASS

#### Acceptance Criteria
- [ ] npx create-theokit my-app → npm install → bun app.ts → works
- [ ] Controllers: CRUD + auth + validation + 404 all PASS
- [ ] Agents: SSE + tools + guards + multi-turn all PASS
- [ ] Frontend: loads in browser
- [ ] 25/25 functional tests PASS

#### DoD
- [ ] Dogfood PASS

---

## Coverage Matrix

| # | Bug | Task | Resolution |
|---|---|---|---|
| 1 | create-theokit `.` name | T3.1 | Handle `.` as current dir |
| 2 | Version ranges prerelease | T1.1 | Exact prerelease versions |
| 3 | NotFoundException → 500 | T2.1 | HttpException catch in TheoApp |
| 4 | Guards ignored on agents | T1.3 | Guard enforcement in agent routes |
| 5 | No built-in stream factory | T1.2 | Move llm-runner to agents package |
| 6 | Tool schemas incomplete | T2.2 | Fix Zod→JSON Schema converter |
| 7 | Tool field naming | T3.2 | Fix template tool definitions |
| 8 | Frontend not served | T2.3 | Inline HTML in template |

**Coverage: 8/8 bugs covered (100%)**

## Global Definition of Done

- [ ] All 8 bugs fixed
- [ ] Packages re-published on npm
- [ ] Fresh dogfood (outside monorepo) passes 25/25 functional tests
- [ ] Zero manual workarounds needed
- [ ] bun test in monorepo still passes (zero regression)

## Failure scenarios

| Dependency | Failure mode | Expected behavior |
|---|---|---|
| OpenRouter API | Key missing | Clear error: "Set OPENROUTER_API_KEY" |
| OpenRouter API | 429 rate limit | SSE error event with retryable: true |
| npm registry | Package not found | Clear error with install command |

## Final Phase: Integration Validation (MANDATORY)

```bash
# 1. Publish
npm publish packages/http-decorators --access public
npm publish packages/agents --access public
npm publish packages/create-theo --access public

# 2. Fresh dogfood
cd /tmp && rm -rf dogfood-test
npx create-theokit dogfood-test
cd dogfood-test && npm install
OPENROUTER_API_KEY=$KEY bun app.ts

# 3. Run all 29 tests from dogfood-test-plan.md
```
