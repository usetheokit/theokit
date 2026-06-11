# Plan: Next.js Render Patterns Adoption — 9 Patterns from app-render/

> **Version 1.0** — Adopt 9 patterns from Next.js `app-render/` directory into TheoKit, prioritized by impact and feasibility. Patterns range from immediate (error digestion) to foundational (streaming SSR, component tree). Each pattern is a self-contained task with TDD.

## Goal

> Ship 9 Next.js-inspired render patterns into `@theokit/http` so that TheoKit achieves feature parity with Next.js on error handling, streaming, component composition, and server actions, measured by all 9 pattern tests passing AND `pnpm --filter @theokit/http test` green.

## Context

Analysis of Next.js `packages/next/src/server/app-render/` (91 files, 9642 lines in app-render.tsx alone) identified 9 patterns applicable to TheoKit without requiring webpack/turbopack. Pattern 1 (AsyncLocalStorage) already shipped as `getRequestContext()`. The remaining 8 are the scope of this plan.

## Baseline Context

### Files that will be touched

| File | LoC today | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/http/src/request-context.ts` | 82 | `aabebe4` (2026-06-11) | AsyncLocalStorage request context (Pattern 1 DONE) | `getRequestContext()` signature |
| `packages/http/src/app.ts` | ~540 | `aabebe4` (2026-06-11) | TheoApp class — SSR via `renderToString` | `handleRequest` → `handleRequestInContext` |
| `packages/http/src/exceptions/http-exception.ts` | ~90 | `b265e27` (2026-06-11) | HttpException hierarchy | Factory pattern for status codes |
| `packages/http/src/error-digest.ts` (NEW) | 0 | — | Error digestion (Pattern 3) | — |
| `packages/http/src/stream-renderer.ts` (NEW) | 0 | — | Streaming SSR (Pattern 4) | — |
| `packages/http/src/component-tree.ts` (NEW) | 0 | — | Component tree composition (Pattern 2) | — |
| `packages/http/src/server-inserted-html.ts` (NEW) | 0 | — | Late-stage HTML injection (Pattern 7) | — |
| `packages/theo/src/server/auth/crypto.ts` | ~80 | existing | AES-GCM encryption (already exists for sessions) | — |

### Architecture boundaries

- All new code in `packages/http/src/` — no cross-package deps
- `react-dom/server` stays as optional peerDep (externalized in tsup)
- `node:async_hooks` already used (request-context.ts)
- `node:crypto` already used (in packages/theo for sessions — NOT in packages/http)

## Prior Art & Related Work

- **Next.js** (`.claude/knowledge-base/references/next.js/packages/next/src/server/app-render/`)
  - `create-error-handler.tsx` — error digestion
  - `stream-ops.ts` — streaming abstraction
  - `create-component-tree.tsx` — recursive composition
  - `action-handler.ts` — server action dispatch
  - `encryption.ts` — action arg encryption
  - `render-css-resource.tsx` — CSS precedence
  - `make-get-server-inserted-html.tsx` — late HTML injection
  - `postponed-state.ts` — PPR
  - `cache-signal.ts` — cache signals
- **TheoKit existing** — `getRequestContext()` (Pattern 1 done), `scan.ts` (file scanner), `crypto.ts` (AES-GCM)

## Objective

- [ ] P1: AsyncLocalStorage request context — **DONE** (`getRequestContext()`)
- [ ] P2: Component tree recursive composition from file conventions
- [ ] P3: Error digestion (hash + context + no stack leak)
- [ ] P4: Streaming SSR (`renderToReadableStream` replacing `renderToString`)
- [ ] P5: Server action handler in TheoApp
- [ ] P6: Action argument encryption (AES-GCM)
- [ ] P7: CSS resource injection with precedence
- [ ] P8: Late-stage server-inserted HTML (polyfills, traces)
- [ ] P9: Cache revalidation signals

## ADRs

### D1 — Incremental adoption, not rewrite

**Decision:** Each pattern is a standalone module with its own export. TheoApp opts in via config flags. No breaking changes to existing API.

**Rationale:** TheoKit has 659+ tests and published packages. A rewrite would break consumers. Each pattern adds a capability without removing existing ones. Per YAGNI (G11), patterns ship when they have a consumer.

**Alternative rejected:** Rewrite TheoApp to match Next.js architecture. Rejected: scope too large, breaks existing users, requires bundler integration.

### D2 — Web Standards streaming (ReadableStream, not Node Streams)

**Decision:** Use `renderToReadableStream` (Web Standard) as primary, with `renderToPipeableStream` (Node) as fallback.

**Rationale:** TheoKit is runtime-agnostic (G8). ReadableStream works on Node 18+, Bun, Deno, Cloudflare Workers. PipeableStream is Node-only.

**Alternative rejected:** Node-only `renderToPipeableStream`. Rejected: breaks Bun/Deno/edge compatibility.

### D3 — Error digests use crypto.subtle (Web Standard)

**Decision:** Error digest computed via `crypto.subtle.digest('SHA-256', ...)` (Web Standard), not `node:crypto`.

**Rationale:** Same as D2 — runtime-agnostic. `crypto.subtle` is available on all target runtimes.

**Alternative rejected:** `node:crypto.createHash('sha256')`. Rejected: Node-only.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Streaming SSR adds complexity to TheoApp | Medium | Behind `streaming: true` flag, default off | Framework |
| Component tree composition may not match Next.js exactly | Low | TheoKit's simpler model (no parallel routes) is sufficient | Framework |
| Action encryption requires key management | Medium | Reuse existing session secret from `createSessionManager` | Framework |
| 9 patterns is a large scope | Medium | Each is independent — can ship incrementally | Framework |

## Unresolved Questions

- Q1: Should streaming be default-on or opt-in? (Recommendation: opt-in via `streaming: true` in TheoApp.create)
- Q2: Should action encryption reuse session secret or have its own key? (Recommendation: reuse, one secret to manage)

## Dependency Graph

```
P1 (DONE) ──▶ P3 (error digest) ──▶ P4 (streaming) ──▶ P8 (server-inserted HTML)
                                        │
P2 (component tree) ───────────────────▶│
                                        │
P5 (server actions) ──▶ P6 (encryption) │
                                        │
P7 (CSS precedence) ───────────────────▶│
                                        │
P9 (cache signals) ────────────────────▶│
```

P3, P2, P5, P7, P9 can run in parallel. P4 depends on P3. P6 depends on P5. P8 depends on P4.

---

## Phase 1: Error Digestion + Component Tree (parallel)

**Objective:** Ship error digest pattern and recursive component tree — foundations for streaming.

### T1.1 — Error digestion: digest + context + no stack leak

#### Objective
Create `error-digest.ts` with `digestError()` that converts any thrown value into a stable hash + context object. Production errors never leak stack traces to the client.

#### Why this step
Next.js `create-error-handler.tsx` converts errors to digests — stable IDs that can be logged server-side and sent to the client without leaking internals. TheoKit's `HttpException` sends raw messages. This pattern prevents information disclosure (OWASP A01).

#### Evidence
- Next.js `create-error-handler.tsx:10-50` — error digestion pattern
- TheoKit `http-exception.ts:37-60` — raw message in response (no digest)

#### Files to edit
```
packages/http/src/error-digest.ts (NEW) — digestError(), DigestedError type
packages/http/src/index.ts — export digestError, DigestedError
packages/http/tests/unit/error-digest.test.ts (NEW) — 8+ tests
```

#### TDD
```
RED:     test_digest_produces_stable_hash() — same error → same digest
RED:     test_digest_different_errors_different_hash() — different error → different digest
RED:     test_digest_includes_context() — context has route, phase, source
RED:     test_digest_strips_stack_in_production() — NODE_ENV=production → no stack
RED:     test_digest_keeps_stack_in_development() — NODE_ENV=development → has stack
RED:     test_digest_handles_non_error_throws() — string/number thrown → still digests
RED:     test_digest_http_exception_preserves_status() — HttpException → digest includes status
RED:     test_digest_is_web_standard() — uses crypto.subtle, not node:crypto
GREEN:   Implement error-digest.ts
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http test
```

#### Acceptance Criteria
- [ ] `digestError()` returns `{ digest: string, message: string, status: number, context: ErrorContext, stack?: string }`
- [ ] Digest is SHA-256 hex of error message (stable, deterministic)
- [ ] Stack trace stripped in production, kept in development
- [ ] Works with `crypto.subtle` (Web Standard — no node:crypto)
- [ ] 8+ tests passing

---

### T1.2 — Component tree: recursive composition from file conventions

#### Objective
Create `component-tree.ts` with `composeComponentTree()` that takes scanned route files and produces a nested React element tree with error/loading boundaries.

#### Why this step
Next.js `create-component-tree.tsx` recursively composes layouts, pages, loading, error, and not-found into a tree with proper Suspense boundaries. TheoKit today does `<Layout><Page /></Layout>` manually. This automates the composition from file conventions.

#### Evidence
- Next.js `create-component-tree.tsx:200-400` — recursive tree builder
- TheoKit `scan.ts` scans files but doesn't compose tree
- TheoKit template `app.tsx` manually nests `<Layout><Page />`

#### Files to edit
```
packages/http/src/component-tree.ts (NEW) — composeComponentTree(), RouteTree type
packages/http/src/index.ts — export composeComponentTree
packages/http/tests/unit/component-tree.test.ts (NEW) — 6+ tests
```

#### TDD
```
RED:     test_compose_layout_wraps_page() — layout wraps page element
RED:     test_compose_nested_layouts() — parent layout wraps child layout wraps page
RED:     test_compose_loading_adds_suspense() — loading.tsx becomes Suspense fallback
RED:     test_compose_error_adds_boundary() — error.tsx becomes error boundary wrapper
RED:     test_compose_not_found_fallback() — not-found.tsx used when no page matches
RED:     test_compose_empty_tree_returns_null() — no page → null
GREEN:   Implement component-tree.ts
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http test
```

#### Acceptance Criteria
- [ ] `composeComponentTree(tree)` accepts `RouteTree` (from scan.ts output) and returns React element
- [ ] Layouts wrap children recursively
- [ ] `loading.tsx` → `<Suspense fallback={<Loading />}>`
- [ ] `error.tsx` → error boundary wrapper
- [ ] 6+ tests passing

---

## Phase 2: Streaming SSR + Server Actions (parallel)

**Objective:** Replace blocking `renderToString` with streaming, and add server action dispatch.

### T2.1 — Streaming SSR via renderToReadableStream

#### Objective
Create `stream-renderer.ts` with `renderToStream()` that replaces `renderToString` for React SSR. Returns a `ReadableStream` instead of a string. TheoApp serves the stream as a chunked response.

#### Why this step
`renderToString` blocks until the entire HTML is ready. `renderToReadableStream` sends the shell immediately and streams Suspense content as it resolves. Next.js uses this for all App Router rendering (`stream-ops.ts`).

#### Evidence
- Next.js `stream-ops.ts` + `stream-ops.web.ts` — streaming abstraction
- TheoKit `app.ts:190-191` — `renderToString` blocks
- TheoKit `entry-server.ts:87-136` — already generates streaming code for Vite mode (not standalone)

#### Files to edit
```
packages/http/src/stream-renderer.ts (NEW) — renderToStream(), StreamRenderOptions
packages/http/src/app.ts — add streaming: true option, wire renderToStream
packages/http/tests/unit/stream-renderer.test.ts (NEW) — 5+ tests
```

#### TDD
```
RED:     test_render_to_stream_returns_readable_stream() — returns ReadableStream
RED:     test_stream_includes_doctype() — stream starts with <!DOCTYPE html>
RED:     test_stream_includes_shell() — <html><head><body> in first chunk
RED:     test_stream_content_type_is_html() — response has text/html content-type
RED:     test_fallback_to_string_when_no_streaming() — streaming: false uses renderToString
GREEN:   Implement stream-renderer.ts + wire into TheoApp
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http test
```

#### Acceptance Criteria
- [ ] `renderToStream(element)` returns `ReadableStream`
- [ ] TheoApp `streaming: true` serves streamed response
- [ ] Default (`streaming: false`) keeps `renderToString` behavior
- [ ] DOCTYPE injected automatically
- [ ] 5+ tests passing

---

### T2.2 — Server action handler in TheoApp

#### Objective
Add server action dispatch to TheoApp. When a POST request has `X-Theo-Action` header, route to the action handler instead of the controller pipeline.

#### Why this step
Next.js `action-handler.ts` intercepts action requests via RSC headers. TheoKit's `defineAction` exists in `packages/theo` (Vite mode) but not in standalone `@theokit/http`. Adding action dispatch enables form handling in the template.

#### Evidence
- Next.js `action-handler.ts:50-200` — action detection + dispatch
- TheoKit `define-action.ts` — action definition exists in packages/theo
- TheoKit `action-execute.ts` — execution exists in packages/theo

#### Files to edit
```
packages/http/src/action-handler.ts (NEW) — handleAction(), ActionDefinition
packages/http/src/app.ts — wire action handler before controller routes
packages/http/tests/unit/action-handler.test.ts (NEW) — 5+ tests
```

#### TDD
```
RED:     test_action_detected_by_header() — X-Theo-Action header triggers action path
RED:     test_action_executes_registered_function() — calls the registered action handler
RED:     test_action_validates_input_with_zod() — Zod schema validated before execution
RED:     test_action_returns_json_result() — action result returned as JSON
RED:     test_action_without_header_skips() — normal POST goes to controller
GREEN:   Implement action-handler.ts + wire into TheoApp
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http test
```

#### Acceptance Criteria
- [ ] `X-Theo-Action: <action-id>` triggers action dispatch
- [ ] Zod input validation before execution
- [ ] JSON response with result or error
- [ ] 5+ tests passing

---

## Phase 3: Encryption + CSS + Server-Inserted HTML

**Objective:** Security hardening and asset injection patterns.

### T3.1 — Action argument encryption (AES-GCM)

#### Objective
Create `action-encryption.ts` with `encryptActionArgs()` / `decryptActionArgs()` using AES-GCM via `crypto.subtle` (Web Standard). Prevents client-side tampering of server action arguments.

#### Evidence
- Next.js `encryption.ts` — AES-GCM for action args
- TheoKit `crypto.ts` — AES-GCM already used for sessions (in packages/theo)

#### Files to edit
```
packages/http/src/action-encryption.ts (NEW) — encrypt/decrypt action args
packages/http/tests/unit/action-encryption.test.ts (NEW) — 5+ tests
```

#### TDD
```
RED:     test_encrypt_decrypt_roundtrip() — encrypt then decrypt returns original
RED:     test_different_keys_fail_decrypt() — wrong key → throws
RED:     test_tampered_ciphertext_fails() — modified ciphertext → throws
RED:     test_uses_web_crypto() — uses crypto.subtle, not node:crypto
RED:     test_random_iv_per_call() — two encryptions of same data produce different ciphertext
GREEN:   Implement action-encryption.ts
VERIFY:  pnpm --filter @theokit/http test
```

---

### T3.2 — CSS resource injection with precedence

#### Objective
Create `css-resource.ts` with `renderCssResource()` that generates `<link>` or `<style>` elements with React `precedence` attribute for proper ordering.

#### Evidence
- Next.js `render-css-resource.tsx:12-80` — CSS precedence pattern

#### Files to edit
```
packages/http/src/css-resource.ts (NEW) — renderCssResource()
packages/http/tests/unit/css-resource.test.ts (NEW) — 4+ tests
```

#### TDD
```
RED:     test_external_css_creates_link_element() — generates <link rel="stylesheet">
RED:     test_inline_css_creates_style_element() — generates <style> with content
RED:     test_precedence_attribute_set() — precedence prop present for ordering
RED:     test_dev_cache_bust_query_param() — adds ?v=timestamp in dev mode
GREEN:   Implement css-resource.ts
VERIFY:  pnpm --filter @theokit/http test
```

---

### T3.3 — Server-inserted HTML (late-stage injection)

#### Objective
Create `server-inserted-html.ts` with `createServerInsertedHTML()` that allows injecting HTML chunks (polyfills, traces, error tags) into the stream after initial render.

#### Evidence
- Next.js `make-get-server-inserted-html.tsx` — stateful closure yielding HTML chunks
- Used for polyfills, OpenTelemetry trace tags, error messages

#### Files to edit
```
packages/http/src/server-inserted-html.ts (NEW) — createServerInsertedHTML()
packages/http/tests/unit/server-inserted-html.test.ts (NEW) — 4+ tests
```

#### TDD
```
RED:     test_insert_html_once() — polyfill inserted exactly once
RED:     test_no_duplicate_insertions() — calling twice doesn't duplicate
RED:     test_multiple_chunks_accumulated() — add trace + polyfill → both present
RED:     test_reset_clears_state() — reset function clears all inserted HTML
GREEN:   Implement server-inserted-html.ts
VERIFY:  pnpm --filter @theokit/http test
```

---

## Phase 4: Cache Signals + Integration Validation

**Objective:** Cache revalidation and final validation.

### T4.1 — Cache revalidation signals

#### Objective
Create `cache-signal.ts` with `revalidateTag()` and `revalidatePath()` functions that signal the framework to invalidate cached responses.

#### Evidence
- Next.js `cache-signal.ts` — cache warmup coordination
- TheoKit `packages/theo/src/cache/` — cache primitives already exist

#### Files to edit
```
packages/http/src/cache-signal.ts (NEW) — revalidateTag(), revalidatePath()
packages/http/tests/unit/cache-signal.test.ts (NEW) — 4+ tests
```

#### TDD
```
RED:     test_revalidate_tag_emits_signal() — tag signal stored in request context
RED:     test_revalidate_path_emits_signal() — path signal stored in request context
RED:     test_multiple_tags_accumulated() — multiple calls accumulate
RED:     test_signals_cleared_per_request() — new request starts clean
GREEN:   Implement cache-signal.ts
VERIFY:  pnpm --filter @theokit/http test
```

---

## Coverage Matrix

| # | Pattern (Next.js source) | Task | Resolution |
|---|---|---|---|
| 1 | AsyncLocalStorage (`work-async-storage.external.ts`) | DONE | `getRequestContext()` shipped |
| 2 | Component tree (`create-component-tree.tsx`) | T1.2 | `composeComponentTree()` |
| 3 | Error digestion (`create-error-handler.tsx`) | T1.1 | `digestError()` |
| 4 | Streaming SSR (`stream-ops.ts`) | T2.1 | `renderToStream()` |
| 5 | Server actions (`action-handler.ts`) | T2.2 | `handleAction()` |
| 6 | Action encryption (`encryption.ts`) | T3.1 | `encryptActionArgs()` |
| 7 | CSS precedence (`render-css-resource.tsx`) | T3.2 | `renderCssResource()` |
| 8 | Server-inserted HTML (`make-get-server-inserted-html.tsx`) | T3.3 | `createServerInsertedHTML()` |
| 9 | Cache signals (`cache-signal.ts`) | T4.1 | `revalidateTag()` / `revalidatePath()` |

**Coverage: 9/9 patterns covered (100%)**

## Global Definition of Done

- [ ] All 9 patterns implemented with tests
- [ ] `pnpm --filter @theokit/http test` green (349+ existing + 47+ new)
- [ ] `pnpm --filter @theokit/http build` green
- [ ] `npx eslint packages/http/src --max-warnings=0` zero errors
- [ ] `bash scripts/quality-gate.sh` — 0 FAIL
- [ ] Zero `node:crypto` in new code (Web Standard `crypto.subtle` only)
- [ ] All new exports documented in barrel `index.ts`
- [ ] CHANGELOG.md updated under `[Unreleased]`

## Failure scenarios

(none — no external I/O touched; all patterns are in-process)

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/http test
pnpm --filter @theokit/http build
npx eslint packages/http/src --max-warnings=0
bash scripts/quality-gate.sh
```

### Acceptance Criteria

- [ ] All test suites green (349+ existing + 47+ new = 396+)
- [ ] Build succeeds (ESM + DTS)
- [ ] Zero lint errors
- [ ] Quality gate PASS
