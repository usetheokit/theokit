# Release theokit@0.11.6

**Date:** 2026-06-30
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Type:** patch (bug fix) — changesets flow
**Source:** theocode#32 live-test follow-up; framework bug theokit#56
**PR:** https://github.com/usetheodev/theokit/pull/57 (develop → main)
**Issue:** https://github.com/usetheodev/theokit/issues/56

## What shipped

Fix `defineAgentEndpoint` returning an empty (0-byte) SSE stream for every prompt on Node ≥ 23.

Node 23 added `http.IncomingMessage.prototype.signal` — an `AbortSignal` that fires
`abort` the instant the request body is fully received (`req.complete === true`), NOT
when the client disconnects. `resolveAbortSignal` duck-typed a Web `Request` as "has
`.signal` with `aborted` + `addEventListener`"; on Node 24 the Node `IncomingMessage`
also satisfied that shape, so the wrapper returned the request-lifecycle signal —
already aborted by the time the handler primes — and closed every agent SSE stream
before the first `yield`. Every agent response came back empty on Node 24, even though
the handler worked in-process.

The fix discriminates a Node `IncomingMessage` (an `EventEmitter`, `typeof r.on ===
'function'`) from a Web `Request` (no `.on`): `r.signal` is trusted directly only when
the request is not a Node object. For the Node path, client-disconnect is wired to the
underlying socket close (`req.socket.on('close')` — the only event that means "client
gone", never fires at request-body-end), with `req`'s own `'close'` guarded by
`complete` to ignore Node ≥ 23 body-end noise.

## Evidence

- TDD: `tests/unit/regression-2-define-agent-endpoint-node23-signal.test.ts` (RED→GREEN).
- 24/24 endpoint tests green; zero regression (4 suite failures are pre-existing,
  confirmed by baseline stash).
- Node v24.18.0 probes: `req.signal` aborts at ~1ms (body-end); `req.socket` close only
  on real disconnect (~503ms).
- Live (Node 24, theocode `theo start`, real OpenRouter): token-by-token SSE streaming
  restored (`data: {"type":"message","content":"..."}`), was 0 bytes.

## Commits

- `068fda0` fix(server): defineAgentEndpoint empty SSE stream on Node >=23 (#56)
- `934176e` chore(release): theokit@0.11.6

## Post-merge steps (on "merged")

1. `pnpm build` (theokit).
2. Publish `theokit@0.11.6` to npm — manual `cd packages/theo && npm publish --no-provenance`
   (Actions billing path; per the 0.11.5 cycle) OR changesets CI if enabled.
3. Tag `theokit@0.11.6` (annotated) pointing at the merge commit; push.
4. `gh release create theokit@0.11.6`.
5. theocode adopts: bump `theokit` dep to `^0.11.6`, `pnpm install`, verify live.
