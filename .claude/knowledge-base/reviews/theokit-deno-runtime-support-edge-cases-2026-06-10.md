# Edge Case Review — theokit-deno-runtime-support

Date: 2026-06-10
Tasks analyzed: 4
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Deno.serve() returns Deno.HttpServer which has different shutdown API
- **Affected task:** T1.1 (Deno adapter)
- **Family:** Boundary / State
- **Scenario:** The plan's pseudo-code calls `server.shutdown()` but Deno 2.x `Deno.HttpServer` uses `server.shutdown()` which returns a `Promise<void>`. The `close(callback?)` in `ServerHandle` is sync-shaped (callback, not promise). If `close()` doesn't await the shutdown promise, the server may not fully close before the callback fires.
- **Impact:** Port not released on close — next test that binds the same port fails with EADDRINUSE.
- **Suggested fix:** `close(cb?) { server?.shutdown().then(() => cb?.()) }` — chain the promise to the callback.

## SHOULD TEST

### EC-2: Deno.serve() port 0 auto-assignment
- **Affected task:** T1.1 (Deno adapter)
- **Suggested test:** `test_deno_adapter_port_zero_auto_assigns()` — `Deno.serve({ port: 0 })` should auto-assign an available port. Verify `handle.address()?.port` is > 0 and not 0.

### EC-3: reflect-metadata import resolution on Deno
- **Affected task:** T2.1 (Test validation)
- **Suggested test:** `test_reflect_metadata_works_on_deno()` — `import 'reflect-metadata'` resolves on Deno (via node_modules or npm: specifier). `Reflect.defineMetadata` is available after import. This is the #1 risk for Deno compat.

## DOCUMENT

### EC-4: Deno permissions model — tests need --allow-net --allow-read
- **Accepted risk:** Deno's security model requires explicit permissions. Tests that create HTTP servers need `--allow-net`. Tests that read files need `--allow-read`. This is not a bug — it's Deno's design. Document in README: "Run tests with `deno test --allow-net --allow-read`."

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 1 (EC-1) | 1 (EC-2) | 0 |
| T2.1 | 1 | 0 | 1 (EC-3) | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T3.1 | 1 | 0 | 0 | 1 (EC-4) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 1 MUST FIX (shutdown promise chaining) needs absorption.
