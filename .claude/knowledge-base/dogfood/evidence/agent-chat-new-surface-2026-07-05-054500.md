---
scenario: agent-chat-new-surface
date: 2026-07-05
operator: maintainer (M6 live dogfood)
outcome: fail
summary: The FIRST live dogfood surfaced two real v1 bugs — a stale SDK pin (dev won't start) and a tool-call crash.
---

# Evidence — the failure story (two v1 bugs the dogfood caught)

A dogfood without failures is theatre. The M6 live run — the first time the shipped v1 surface was
driven end-to-end against a real model, not a stubbed SDK — surfaced two real bugs that would have
shipped broken. Both are fixed (M6 commit `2302dcb`), destined for the `theokit@0.15.1` release.

## Failure 1 — a fresh scaffold would not even start

`npx create-theokit` → `pnpm install` → `theokit dev` **crashed on startup**:

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './compaction' is not defined by "exports"
  in .../@theokit/sdk/package.json imported from .../@theokit/agents/dist/chunk-….js
```

Root cause: the default template pinned `@theokit/sdk@^1.1.0`, which lacks the `./compaction` subpath
export that `@theokit/agents@0.30.0` requires (`peerDependency >= 2.13.0`). The `sync:templates` script
only syncs workspace packages, so the external `@theokit/sdk` pin silently rotted. **Fix:** bump the
template + fixture pin to `^2.13.0`.

## Failure 2 — the first tool call crashed

After fixing #1, the chat streamed fine — but the FIRST tool call crashed:

```
data: {"type":"error","errorText":"TypeError: Cannot read properties of undefined (reading 'def')"}
```

Root cause (confirmed by a minimal repro: real SDK `defineTool` + a JSON-Schema object → the exact
crash): `buildSdkTools` re-ran `defineAgentTool`'s already-lowered JSON-Schema tool through the SDK's
`defineTool`, which expects a live Zod schema (reads `.def`). The tool-call path was never tested live
before (the monorepo tests stub the SDK), so this slipped through M2–M4. **Fix:** `buildSdkTools` routes
by `inputSchema` shape — Zod → `defineTool`; already-SDK-ready `CustomTool` → forwarded raw. Locked by a
regression test.

## Lesson

Stubbed E2E tests prove the wire is correct but not that a real model + real tool execution works —
exactly the "synthetic" gap the dogfood golden rule guards against. The live dogfood is what caught both.
