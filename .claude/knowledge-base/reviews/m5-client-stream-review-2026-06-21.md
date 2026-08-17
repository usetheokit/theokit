# Review — M5-1 + M5-2 (`theokit/client` stream derivations)

**Date:** 2026-06-21
**Slug:** m5-client-stream
**Commits:** `f0f8270` (impl) → `07d7e17` (review fixes)
**Reviewers:** 2 independent agents (code-correctness + test-quality/cross-validation)
**Verdict:** **READY_TO_MERGE**

## Scope

Adds derived views over the agent SSE event stream to the `theokit/client` public surface:

- **M5-1** — `useAgentStream` returns `liveText` (concatenated message content) + `error` (last error event, `code`/`retriable` preserved); pure `deriveLiveText`/`deriveError` exported.
- **M5-2** — `useAgentToolCards` hook + pure `foldAgentToolCards` reducer fold the stream into correlated tool cards (`running`/`success`/`error`); correlation by event id with FIFO-by-name fallback; success/error decided by an injectable `resolveEnvelope`.

## Findings & disposition

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| M1 | MEDIUM | `foldAgentToolCards` mis-folded when call/result disagreed on carrying an `id` (contract-legal): duplicate orphan card + original stranded `running`. | **FIXED** `07d7e17` — dual-index (byId + FIFO-by-name), `matchResultCard` consumes from both; +2 regression tests (both directions). |
| HIGH-1 | HIGH | FIFO-by-name test used a 1-element queue → did not prove FIFO ordering. | **FIXED** — added two concurrent same-name id-less calls asserting oldest-first pairing. |
| HIGH-2 | HIGH | `deriveError` last-wins untested with multiple errors. | **FIXED** — added multi-error test (auth replaces rate_limit). |
| MED-1 | MEDIUM | Out-of-order by-id correlation untested. | **FIXED** — added `result id:2` before `result id:1` test. |
| MED-2 | MEDIUM | Orphan card shape under-asserted (`length`+`status` only). | **FIXED** — orphan test now pins full card via `toEqual`. |
| MED-3 | MEDIUM | `useAgentToolCards` hook resolver wiring untested. | **ACCEPTED** — repo has no React-testing infra; convention is to test the pure functions, not hooks (`useAgentStream` itself has no hook test). The hook is a thin destructure+passthrough; `resolveEnvelope` threading is covered at the pure-reducer level. Documented limitation. |
| L1 | LOW | Plan test paths said `tests/client/...`; actual is `tests/unit/...`. | **FIXED** — plan reconciled to `tests/unit/`. |
| L2 | LOW | Default template still hand-rolls `switch(event.type)`. | **ACCEPTED** — out of scope; consumer migration is M5-3..M5-7. Wiring-triad "caller" pillar satisfied by tests this slice; production caller arrives with the template migration. |
| LOW-1/2/3 | LOW | empty `deriveLiveText`/`deriveError`; resolved+unresolved sibling; dup-id. | **FIXED** (empty + sibling tests added). Dup-id EC-3 remains the documented accepted-risk; the M1 fix now resolves both dup-id results rather than stranding one. |

### Clean (both reviewers, INFO)

- **Purity** — `deriveLiveText`/`deriveError`/`foldAgentToolCards` mutate only locally-constructed objects; input `events` never touched. Memo deps correct (`[events]`, `[stream.events, resolveEnvelope]`).
- **Type safety** — no `any`, no `@ts-ignore`, no unjustified `as`; explicit return types on every public function; `JSON.parse` typed `unknown` then narrowed.
- **`defaultResolveEnvelope`** — conservative default (`ok===false` → error, else success) is correct per ADR D3; cannot manufacture a false error; injectable resolver is the escape hatch.
- **Architecture** — `client → core/contracts/agent-events` is the documented legal deep-import exception (architecture.md invariant 3); zero cycles; all files ≤142 LoC (G6); every new export has a consumer + test (G7).

## Gate evidence

| Gate | Result |
|---|---|
| `vitest run tests/unit/agent-stream-derivations.test.ts` | **22 passed** (was 15 pre-review) |
| `tsc --noEmit -p packages/theo/tsconfig.json` | exit 0 |
| `eslint --max-warnings=0` (changed files) | clean |
| Existing stream consumers (`agent-stream-core`, `stream-agent-run`) | 33 passed |
| Barrel wiring (`import('theokit/client')`) | asserted + green |
| CHANGELOG `[Unreleased]` + `.changeset/*` | present |
| code-quality (delta) | CLEAN — `FAIL_HARD` is untuned whole-repo `knip` baseline; zero findings in this slice's files (see audit disposition) |

## Verdict

**READY_TO_MERGE.** One MEDIUM correctness defect (M1) + two HIGH and three MEDIUM test-coverage gaps were all fixed in-cycle with regression tests (`07d7e17`). The two accepted items (MED-3 hook test, L2 template migration) are consistent with repo convention and the staged M5 roadmap respectively. No BLOCKER, zero open HIGH.
