---
name: implement-crossval-native-routing-web-fixes-sepa-knowledge
description: Paired knowledge skill for the crossval-native-routing-web-fixes SEPA. Use ONLY when the SEPA agent needs to refresh external knowledge (react-router v7 param syntax, Node NODE_MODULE_VERSION ABI semantics, pnpm rebuild behavior) mid-implementation. Read-only reference companion to the SEPA agent definition.
---

# SEPA Knowledge — crossval-native-routing-web-fixes

Companion to `.claude/agents/implement-crossval-native-routing-web-fixes-2026-06-16/sepa.md`. The SEPA agent is the source of truth for the role; this skill holds the durable external-knowledge anchors so the SEPA does not re-derive them each iteration.

## Anchors (verify against the live repo before citing)

### Native bindings (Phase 1)
- ABI contract: `process.versions.modules` is the `NODE_MODULE_VERSION`. Mismatch with a compiled `.node` binary throws `NODE_MODULE_VERSION X required, got Y` or `Module did not self-register` at `require()` time.
- Reference algorithm: `CLAUDE.md § Native bindings discipline` — sentinel at `node_modules/.cache/preflight-native-{abi}.ok`; `CI=true` fail-closed (no auto-rebuild); `NATIVE_DEPS = ['better-sqlite3']`; EC-1 `findRebuildCwd` walks realpath for the `@theokit/sdk` workspace-link hardlink.
- The RED spec `tests/unit/preflight-native-bindings.test.ts` is the authoritative contract — implement against it, never edit it.

### react-router (Phase 2)
- react-router v7 page matcher uses `:param` (single segment) and `*` (splat/catch-all) — NOT the server's regex `:name`/`:...name`. Param names must match `[A-Za-z0-9_]+` (hence EC-5).
- `generate.ts` emits a react-router config with `Outlet` + `React.lazy`. The catch-all `*` must be the terminal segment of its branch (EC-9).

### Web request path (Phase 3)
- `executeWebRequest` (Web Standards `Request`→`Response`) is reached by `node-web-adapter` + server entries; the 6 cloud adapters use `executeRoute` (Node). Do not conflate (EC-2).
- G8: `server/http/web-*` files use `Request`/`Response`, never Node `req`/`res`.

## When to invoke

The SEPA invokes this skill via the `Skill` tool only when an iteration question requires confirming external library/runtime behavior not already in the plan or repo. For plan/ADR/rule questions, the SEPA reads the source files directly (faster, authoritative).
