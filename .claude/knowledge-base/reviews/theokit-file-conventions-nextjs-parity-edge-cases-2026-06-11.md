# Edge Case Review — theokit-file-conventions-nextjs-parity

Date: 2026-06-11
Tasks analyzed: 5 (T1.1, T2.1, T2.2, T2.3, T3.1)
Edge cases found: 7 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: static.ts does not exist — was never committed
- **Affected task:** T1.1 (static handler tests)
- **Family:** State
- **Scenario:** `packages/http/src/static.ts` was created during this session but was lost during lint-staged stash/revert cycles. The file does not exist on disk or in git. The plan assumes it exists (213 LoC) but it doesn't.
- **Impact:** Phase 1 and Phase 2 cannot proceed — there is no static file handler to test or rely on.
- **Suggested fix:** T1.1 must CREATE `static.ts` from scratch (not just test it). Rename task to "Create + test static file handler".

### EC-2: app.ts and index.ts references to static were also reverted
- **Affected task:** T2.1 (template refactor)
- **Family:** State
- **Scenario:** The `import { createStaticHandler } from './static.js'` in app.ts and the `export { createStaticHandler }` in index.ts were added during this session but were reverted by lint-staged along with static.ts. app.ts has no `staticHandler` field, no `staticDir` option.
- **Impact:** Even if static.ts is recreated, TheoApp won't use it until app.ts is re-wired.
- **Suggested fix:** T1.1 must include: (1) create static.ts, (2) add `staticDir` to TheoAppOptions, (3) wire handler in app.ts handleRequest, (4) export from index.ts.

### EC-3: public/globals.css already exists in template but app/globals.css also exists — duplicate
- **Affected task:** T2.1 (move CSS to public/)
- **Family:** State
- **Scenario:** Earlier in this session, `globals.css` was copied to `public/globals.css` AND the original in `app/globals.css` was kept. The plan says "DELETE app/globals.css" but doesn't mention that `public/globals.css` may already exist (partial work from earlier).
- **Impact:** Scaffold might copy both, creating confusion. The Tailwind injector (T2.3) targets `app/globals.css` in some code paths and `public/globals.css` in others.
- **Suggested fix:** T2.1 must explicitly: `rm -f app/globals.css app/client.ts` AND verify `public/globals.css` and `public/client.js` are the ONLY copies. Add a test asserting `app/globals.css` does NOT exist after scaffold.

## SHOULD TEST

### EC-4: Static handler with URL-encoded paths (e.g., `/my%20file.css`)
- **Affected task:** T1.1
- **Suggested test:** `test_handler_decodes_url_encoded_path()` — create a file with a space in the name, request with `%20`, verify 200.

### EC-5: Static handler with query parameters (e.g., `/globals.css?v=123`)
- **Affected task:** T1.1
- **Suggested test:** `test_handler_ignores_query_params()` — request `/globals.css?v=123`, verify file is still served (pathname extraction must strip query).

### EC-6: Scaffold with `--src-dir` flag moves files incorrectly
- **Affected task:** T2.3
- **Suggested test:** `test_scaffold_src_dir_preserves_public()` — when `--src-dir` is used, `public/` must NOT be moved into `src/`. Verify `public/globals.css` stays at root-level `public/`, not `src/public/`.

## DOCUMENT

### EC-7: CSS flash of unstyled content (FOUC) on first load
- **Accepted risk:** With CSS loaded via `<link>` instead of inline `<style>`, there's a brief moment where the HTML renders without styles (FOUC). This is acceptable for dev mode. Production apps should use a bundler (Vite) or inline CSS via middleware. Next.js avoids this with its build pipeline — TheoKit standalone mode without Vite cannot. The tradeoff (runtime-agnostic + separate file) is worth the minor visual flash.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 4 | 2 | 2 | 0 |
| T2.1 | 1 | 1 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 1 | 0 | 1 | 0 |
| T3.1 | 1 | 0 | 0 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT

### Required changes before implementation:

1. **EC-1 + EC-2:** T1.1 must be expanded to CREATE static.ts + wire it into app.ts + export from index.ts (not just test an existing handler).
2. **EC-3:** T2.1 must explicitly delete `app/globals.css` and `app/client.ts`, and add a test verifying they don't exist after scaffold.
3. **EC-4 + EC-5:** Add 2 tests to T1.1 TDD section (URL encoding + query params).
4. **EC-6:** Add a test to T2.3 for `--src-dir` flag behavior with public/.
