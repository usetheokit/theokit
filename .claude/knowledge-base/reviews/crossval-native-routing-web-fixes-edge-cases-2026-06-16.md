# Edge Case Review — crossval-native-routing-web-fixes

Date: 2026-06-16
Tasks analyzed: 8 (T1.1, T1.2, T1.3, T2.1, T2.2, T2.3, T3.1, T3.2)
Edge cases found: 19 (MUST FIX: 5, SHOULD TEST: 9, DOCUMENT: 5)

Boundaries inspected: native `require()`/dlopen + `child_process` (Phase 1), build-time file-system scan + react-router config emission (Phase 2), Web-Standards request lifecycle + middleware + the Node-vs-Web pipeline split (Phase 3). Two claims were verified against the live repo before classifying: `.npmrc` has **no** `engine-strict` (so `engines.node` only warns), and the 6 cloud adapters emit `executeRoute` (Node path), **not** `executeWebRequest`.

## MUST FIX

### EC-1: New router unit test must live under `tests/` or it never runs
- **Affected task:** T2.1
- **Family:** Integration
- **Scenario:** The plan's Baseline offers `packages/theo/src/router/scan.test.ts` **or** `tests/unit/router-dynamic-segments.test.ts`. The root `vitest.config.ts` include is `['tests/**/*.test.ts', 'tests/**/*.test-d.ts']` and `packages/theo` has **no** per-package vitest config. A co-located `packages/theo/src/**/*.test.ts` is **silently never collected** — the RED test would "pass" by not existing.
- **Impact:** TDD broken — implementer thinks tests pass; the dynamic-routing spec never executes.
- **Suggested fix:** Drop the co-located option; mandate `tests/unit/router-dynamic-segments.test.ts` (1 plan-text change in T2.1 Files-to-edit + Baseline row).

### EC-2: Phase 3 fix does NOT reach the 6 cloud adapters (they use `executeRoute`, not `executeWebRequest`)
- **Affected task:** T3.1, T3.2
- **Family:** State / Integration (wiring honesty)
- **Scenario:** Verified: `adapters/{vercel,cloudflare,aws-lambda,bun,deno-deploy,netlify}.ts` all emit `import { ... executeRoute ... } from 'theokit/server'` — the **Node** path, which already runs params + middleware. `executeWebRequest` (the Web path being fixed) is called only by `node-web-adapter.ts`, `server/index.ts`, the CSRF endpoints, and `web-plugin-runner.ts`.
- **Impact:** The plan implies Phase 3 closes a production gap; in reality it brings the **Web path** to parity with the already-complete **Node path**, and the cloud adapters are unaffected. Reviewer/implementer could over-claim impact or wire the fix expecting cloud-adapter coverage. The wiring-triad "runtime caller" for Phase 3 is the local Node server via `node-web-adapter`, not the cloud adapters.
- **Suggested fix:** Add one Baseline note + amend Q2: "executeWebRequest serves the node-web-adapter/local-Node path; the 6 cloud adapters use `executeRoute` (Node) which already has params+middleware — full convergence = migrating adapters off `executeRoute`."

### EC-3: Web-path middleware ordering vs the CSRF gate is undefined
- **Affected task:** T3.2
- **Family:** State / Permission
- **Scenario:** The no-hooks branch of `executeWebRequest` runs the CSRF gate then the handler (`web-handler.ts:420+`). The plan inserts middleware "before runHandler" but does not say whether it runs **before or after** the CSRF gate. The Node path (`http/execute.ts`) runs onRequest → middleware → handler with CSRF as its own stage.
- **Impact:** Ambiguous order → either middleware-set auth context is invisible to CSRF, or CSRF is bypassable by a misordered middleware. Security-relevant.
- **Suggested fix:** Specify in T3.2: middleware runs in the **same order as the Node path** relative to the CSRF stage (CSRF gate fires before user middleware).

### EC-4: `[[...slug]]` optional catch-all emits a garbage react-router path
- **Affected task:** T2.1
- **Family:** Format
- **Scenario:** Q3 defers optional catch-all, but `parseSegment` regexes don't reject it: `[[...slug]]` fails the catch-all regex (`^\[\.\.\.`) and matches the dynamic regex `^\[(.+)\]$` → paramName `[...slug]` → emitted as `:[...slug]` (invalid).
- **Impact:** A user folder `[[...slug]]` silently produces a broken route instead of an error (G10 honesty violation).
- **Suggested fix:** In `parseSegment`, reject names matching `/^\[\[/` with a build-time error `"optional catch-all [[...]] not supported yet"` (1 `if`).

### EC-5: Invalid react-router param charset (`[user-id]`, `[user.id]`) silently breaks matching
- **Affected task:** T2.1
- **Family:** Format
- **Scenario:** react-router v6 param names are `[A-Za-z0-9_]+`. A folder `[user-id]` → `:user-id`, which react-router parses incorrectly (the `-id` is treated as literal), so the route silently never matches.
- **Impact:** Silent routing failure for a plausible folder name.
- **Suggested fix:** In `parseSegment`, validate `paramName` against `/^[A-Za-z0-9_]+$/`; throw a build-time error naming the offending folder if it fails (1 `if`).

## SHOULD TEST

### EC-6: Sentinel cache keyed on ABI only — a new `NATIVE_DEPS` entry is never probed
- **Affected task:** T1.2
- **Suggested test:** `test_sentinel_invalidates_when_native_deps_change` — with a written sentinel for ABI X, adding a dep to `NATIVE_DEPS` must still probe it. Fix: key the sentinel on `${abi}-${hash(NATIVE_DEPS+versions)}`.

### EC-7: Rebuild "succeeds" but ABI still mismatched → raw dlopen error (resolves Q4)
- **Affected task:** T1.2
- **Suggested test:** `test_ensure_native_throws_actionable_when_rebuild_does_not_fix_abi` — re-probe after rebuild still failing must throw a message mentioning Node version + `pnpm rebuild`, not the raw `NODE_MODULE_VERSION` error.

### EC-8: `pnpm` binary missing (ENOENT) under a non-pnpm consumer
- **Affected task:** T1.2
- **Suggested test:** `test_ensure_native_handles_missing_pnpm` — mock `execFileSync` ENOENT; assert an actionable message ("run your package manager's rebuild for better-sqlite3") rather than a raw spawn crash.

### EC-9: Catch-all `*` with sibling/child segments violates react-router (must be last)
- **Affected task:** T2.2
- **Suggested test:** `test_generate_catchall_must_be_terminal` — a `[...slug]` node with children either rejects at build or the splat is emitted last; assert react-router config validity.

### EC-10: Catch-all param value containing slashes reaches the handler intact
- **Affected task:** T3.1
- **Suggested test:** `test_web_handler_catchall_param_preserves_slashes` — request `/docs/a/b/c` on a `[...path]` route → handler sees `params.path === 'a/b/c'` and Zod (if present) validates the joined string.

### EC-11: Middleware short-circuit on the Web path must preserve `Set-Cookie`
- **Affected task:** T3.2
- **Suggested test:** `test_web_middleware_shortcircuit_preserves_set_cookie` — middleware returns a Response with `Set-Cookie`; assert the header survives (reuse the existing `mergeHookHeaders`/`getSetCookie` path, do not re-implement).

### EC-12: Same middleware module must behave identically on Node (`executeRoute`) and Web (`executeWebRequest`)
- **Affected task:** T3.2
- **Suggested test:** `test_middleware_contract_parity_node_vs_web` — one middleware module run through both runners produces the same ctx mutation + short-circuit behavior (guards the DRY/G12 risk of two divergent runners D4 accepts).

### EC-13: Golden static-output snapshot must be captured BEFORE editing `generate.ts`
- **Affected task:** T2.2
- **Suggested test:** Process note in T2.2 TDD — commit `router-generate-golden.test.ts` baseline against unchanged `generate.ts` first; if written after the edit it locks the new (possibly broken) output instead of guarding the old.

### EC-14: `findRebuildCwd` with nested `/node_modules/.pnpm/` segments
- **Affected task:** T1.1
- **Suggested test:** `test_find_rebuild_cwd_nested_node_modules` — a realpath containing two `/node_modules/` segments resolves to the correct sibling root (decide first-vs-last index deliberately and assert it).

## DOCUMENT

### EC-15: Windows path separators in `findRebuildCwd`
- **Accepted risk:** Dev targets are Linux/macOS (`.nvmrc`, POSIX `.pnpm` paths). The `indexOf('/node_modules/.pnpm/')` heuristic assumes forward slashes. Windows dev is out of scope; note it in the function comment.

### EC-16: `engines.node` could block install only if a consumer sets `engine-strict`
- **Accepted risk:** Verified: root `.npmrc` has **no** `engine-strict`, so pnpm only warns on Node < 22.12. If a downstream consumer sets `engine-strict=true` and runs Node 22.0–22.11, install would block — acceptable, documented, warn-only by default (matches D2 Drawback severity Low).

### EC-17: Non-pnpm consumers (npm/yarn) get no sibling-link rebuild routing
- **Accepted risk:** `findRebuildCwd` keys on the `.pnpm` store path; npm/yarn layouts fall through to `defaultCwd`. The framework's local-dev story is pnpm; acceptable.

### EC-18: Two dynamic siblings at the same path level (`[id]` and `[slug]`)
- **Accepted risk:** react-router first-match wins; ambiguous by construction. Rare and a user authoring error, not a framework bug.

### EC-19: Concurrent `vitest` invocations could double-rebuild
- **Accepted risk:** globalSetup runs once per process; two parallel processes (watch + run) could both rebuild, but `pnpm rebuild` + sentinel write are idempotent. Harmless.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | 1 (EC-14) | 1 (EC-15) |
| T1.2 | 4 | 0 | 3 (EC-6,7,8) | 1 (EC-19) |
| T1.3 | 1 | 0 | 0 | 1 (EC-16) |
| T2.1 | 4 | 2 (EC-4,5) | 0 | 1 (EC-17 shared w/ T1.1 family) |
| T2.2 | 3 | 0 | 2 (EC-9,13) | 1 (EC-18) |
| T2.3 | 0 | 0 | 0 | 0 |
| T3.1 | 2 | 1 (EC-2) | 1 (EC-10) | 0 |
| T3.2 | 3 | 2 (EC-3, EC-2 shared) | 2 (EC-11,12) | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

5 MUST FIX items must be absorbed into a plan v1.1 before `/plan-confidence`:
- **EC-1** (test path under `tests/`), **EC-4** + **EC-5** (reject `[[...]]` + validate param charset) → fold into T2.1.
- **EC-2** (executeWebRequest vs executeRoute scope honesty) → Baseline note + Q2 amendment, touches T3.1/T3.2 framing.
- **EC-3** (middleware/CSRF ordering) → one sentence in T3.2.

None require new abstractions — every fix is an `if`, a test, a path change, or a one-sentence clarification. The 9 SHOULD TEST items strengthen the TDD blocks; the 5 DOCUMENT items are accepted risks.
