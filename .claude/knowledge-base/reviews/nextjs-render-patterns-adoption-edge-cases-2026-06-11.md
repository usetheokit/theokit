# Edge Case Review — nextjs-render-patterns-adoption

Date: 2026-06-11
Tasks analyzed: 8 (T1.1, T1.2, T2.1, T2.2, T3.1, T3.2, T3.3, T4.1)
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: crypto.subtle.digest is async — digestError() cannot be sync
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** `crypto.subtle.digest('SHA-256', ...)` returns a `Promise<ArrayBuffer>`. But error handlers in Express/Hono/TheoKit are typically sync (`catch (err) { return response }`). Making `digestError()` async forces callers to await it, changing the error handling flow.
- **Impact:** Either `digestError()` is async (breaks sync catch blocks) or digest is not SHA-256 (breaks ADR D3).
- **Suggested fix:** Use sync hash for digest: `Array.from(new TextEncoder().encode(msg)).reduce((h, b) => (h * 31 + b) | 0, 0).toString(16)`. It's a stable hash, not crypto-grade — crypto is overkill for error dedup. Next.js uses `Error.digest` property which React sets, not crypto.subtle.

### EC-2: composeComponentTree needs React as dependency — but @theokit/http has React as optional peerDep
- **Affected task:** T1.2
- **Family:** Boundary
- **Scenario:** `composeComponentTree()` creates React elements (`React.createElement`, `<Suspense>`, error boundary class). But `@theokit/http` declares `react` as optional peerDep. If someone uses `@theokit/http` without React (pure API-only mode), importing `component-tree.ts` from the barrel would crash.
- **Impact:** `import { Controller } from '@theokit/http'` would fail if component-tree.ts has a top-level `import React`.
- **Suggested fix:** `composeComponentTree` must use dynamic `import('react')` or be in a separate subpath export (`@theokit/http/react`) that's only imported when React is present. Add to ADR D1.

### EC-3: revalidateTag/revalidatePath already exist in packages/theo/src/cache/
- **Affected task:** T4.1
- **Family:** State (DRY violation)
- **Scenario:** `packages/theo/src/cache/revalidate.ts:15` already exports `revalidateTag()`. `packages/theo/src/cache/cache-engine.ts:59` already has `revalidatePath()`. Creating new ones in `packages/http/src/cache-signal.ts` duplicates existing functionality — violates G12 (DRY guardrail).
- **Impact:** Two `revalidateTag()` functions in the codebase with different behavior. Consumer imports wrong one.
- **Suggested fix:** T4.1 should re-export from `packages/theo` or thin-wrap it, NOT reimplement. Or defer T4.1 entirely — the cache primitives already exist in the right place.

## SHOULD TEST

### EC-4: renderToReadableStream may not exist on older React versions
- **Affected task:** T2.1
- **Scenario:** `renderToReadableStream` was added in React 18. If a consumer uses React 17 (unlikely but possible via peerDep range), the import fails at runtime.
- **Suggested test:** `test_stream_graceful_fallback_to_string()` — if `renderToReadableStream` is not available, fall back to `renderToString` with a warning.

### EC-5: Action handler with malformed JSON body
- **Affected task:** T2.2
- **Scenario:** POST with `X-Theo-Action` header but body is not valid JSON (binary, truncated, wrong content-type).
- **Suggested test:** `test_action_malformed_body_returns_400()` — malformed JSON → 400 with clear error message, not 500.

### EC-6: Encrypt/decrypt with empty string
- **Affected task:** T3.1
- **Scenario:** `encryptActionArgs('')` — empty string is valid input. Some crypto implementations choke on empty buffers.
- **Suggested test:** `test_encrypt_empty_string_roundtrip()` — empty string encrypts and decrypts correctly.

## DOCUMENT

### EC-7: Streaming SSR and error boundaries interact differently
- **Accepted risk:** In `renderToString`, an error in a component aborts the entire render. In `renderToReadableStream`, errors inside `<Suspense>` boundaries are caught and the boundary's fallback is sent. This means the same component may produce different output in string vs stream mode. This is by design (React semantics) but may confuse users who switch `streaming: true` and see different error behavior. Document in the `streaming` option description.

### EC-8: CSS precedence requires React 19+
- **Accepted risk:** The `precedence` prop on `<link>` and `<style>` is a React 19 feature (Resource Loading). If a consumer uses React 18, the precedence attribute is ignored (no error, just no ordering guarantee). TheoKit's template already requires React 19. Document as a React 19 requirement for CSS precedence.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 | 0 | 0 |
| T1.2 | 1 | 1 | 0 | 0 |
| T2.1 | 1 | 0 | 1 | 1 |
| T2.2 | 1 | 0 | 1 | 0 |
| T3.1 | 1 | 0 | 1 | 0 |
| T3.2 | 1 | 0 | 0 | 1 |
| T3.3 | 0 | 0 | 0 | 0 |
| T4.1 | 1 | 1 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

### Required changes:

1. **EC-1:** T1.1 — change digest from `crypto.subtle` (async) to sync hash. Update ADR D3 to clarify digest != crypto. Digest is for dedup/logging, not security.
2. **EC-2:** T1.2 — `composeComponentTree` must use dynamic import or separate subpath export. Cannot be in the main barrel with top-level React import.
3. **EC-3:** T4.1 — either re-export from `packages/theo/src/cache/` or defer entirely. Do NOT reimplement.
4. **EC-4, EC-5, EC-6:** Add 3 tests to TDD sections.
5. **EC-7, EC-8:** Add documentation notes to T2.1 and T3.2.
