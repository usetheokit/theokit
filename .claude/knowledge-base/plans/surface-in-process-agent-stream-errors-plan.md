# Plan: Surface in-process agent stream errors in the unified client

> **Version 1.0** — The unified agent client (`AgentClient` + `useAgent`, M41) silently swallows a turn that fails via an in-stream error chunk: `consumeChunkStream` reads the `ai` `UIMessageStream` without an `onError` handler, so a `{ type: 'error', errorText }` chunk (the shape the in-process runner emits on a provider 401/429/5xx) is absorbed, the stream ends "clean", and the store settles to `status='done'` with `error=undefined`. This plan makes `consumeChunkStream` honor the error chunk (capture via `onError` + `terminateOnError:true`, rethrow after the loop) so the store's existing `#drive` catch surfaces it (`status='error'`, `error` set → the scaffold's `<Notice>` renders). Expected outcome: issue #136 closed; a new negative-case test proves the error reaches `useAgent().error`; zero regression to happy-path streaming or the HTTP/SSE path.

## Goal

> "Enable a TheoKit agent-app user to see a failed turn's error so that a provider failure (401/429/5xx) surfaces as `useAgent().error` instead of a dead UI, measured by `tests/unit/agent-client.test.ts::test_send_error_chunk_sets_error_status` passing (status `'error'` + `error.message` matches the chunk's `errorText`)."

## Context

Issue #136: dogfooding `create-theokit@1.20.1 --surface tui` in a real terminal, a turn sent without (or with an invalid) `OPENROUTER_API_KEY` produced **no spinner, no error, no output** — a dead UI. The scaffold's error binding is correct (`tui/App.tsx:231` `{agent.error ? <Notice variant="error">…</Notice> : null}`), and the store's `#drive` catch is correct (sets `status='error'` on a thrown error). The gap is between them: the in-process runner does not *throw* on a provider error — it *emits* a `{ type:'error', errorText }` UIMessage chunk (mirroring the SSE path that yields an `event: error`). The client's shared stream consumer, `consumeChunkStream`, calls `ai`'s `readUIMessageStream({ stream })` with no `onError` and no `terminateOnError`, so on the error chunk `ai` runs `onError == null ? void 0 : …` (verified at `ai@7.0.14/dist/index.js:7036`) — the error is dropped and the iterator ends normally.

The proximate cause of "não responde" was the missing key; this plan fixes the **second-order defect** that made the missing key invisible. This is a direct `error-handling.md` violation (fail-fast, fail-loud, no swallow) and a `system-design-guardrails.md § G10` violation (silent = worst tech debt).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/theo/src/client/consume-ui-message-stream.ts` | 71 | `069df665` (2026-07-12) | Shared `ai` `UIMessageStream` consumer: `responseToChunkStream` (Response→chunks), `consumeChunkStream` (chunks→reconstructed `UIMessage`), `consumeUIMessageStream` (Response path). Reuses `ai`'s own `parseJsonEventStream`/`readUIMessageStream` (Rule 9 — no reinvented wire parser). | `ai` stays a DYNAMIC import (optional peer); happy-path `onMessage` still fires per reconstruction step; `responseToChunkStream` + `consumeUIMessageStream` signatures unchanged (public via `theokit/client`). |
| `packages/theo/src/client/agent-client.ts` | 225 | `8481ea4b` (2026-07-14) | The framework-agnostic `AgentClient` store (M41): `#drive` opens a transport stream, feeds `consumeChunkStream`, and settles `status`. `catch (err)` at L135-138 sets `status='error'`+`#error`. | `#drive` unchanged in this plan — its existing catch is the surfacing mechanism; the `aborted()` guard (stale-drive protection, HIGH #2) must keep short-circuiting. |
| `tests/unit/agent-client.test.ts` | 409 | (M41 suite) | Store tests: `chunkStream()` fixture builder, `fakeTransport`, `waitSettled`; already has `test_send_5xx_sets_error_status` for the THROWN path (L127). | Existing tests stay green; new test mirrors the `chunkStream`/`waitSettled` convention. |
| `tests/unit/consume-chunk-stream.test.ts` (NEW) | 0 | — | (file to be created) — isolates the consumer's rethrow contract independent of the store. | — |
| `.changeset/fix-silent-agent-stream-error.md` (NEW) | 0 | — | (file to be created) — patch changeset for `theokit`. | — |

### Current callers / dependents

- **Symbol:** `consumeChunkStream()` in `packages/theo/src/client/consume-ui-message-stream.ts`
  - **Callers (production):** `packages/theo/src/client/agent-client.ts:124` (the store's `#drive`, transport path); `packages/theo/src/client/consume-ui-message-stream.ts:22` (`consumeUIMessageStream`, the Response/SSE path).
  - **Re-exports (public surface):** `packages/theo/src/client/index.ts`, `packages/theo/src/client/core.ts` (barrel `theokit/client` + `theokit/client/core`).
  - **Callers (tests):** none today reference `consumeChunkStream` directly (verified: `grep -rln consumeChunkStream --include=*.test.ts` empty) — the new `consume-chunk-stream.test.ts` is the first direct test.
  - **External (public API consumed by other repos):** `consumeUIMessageStream`/`responseToChunkStream` are exported from `theokit/client`; their signatures do NOT change. `consumeChunkStream`'s signature does NOT change (behavior tightens: it now rethrows on an error chunk).

### Domain glossary

- **UIMessageChunk** — `ai`'s streaming wire unit; the error variant is `{ type: 'error', errorText: string }` (`ai@7.0.14/dist/index.d.ts:2048`).
- **`readUIMessageStream`** — `ai`'s consumer that reconstructs `UIMessage`s from a chunk stream; options `{ stream, onError, terminateOnError }` (`…/index.d.ts:6064`). On an error chunk it calls `onError(new Error(chunk.errorText))` and does NOT throw by itself (`…/index.js:7036`).
- **`#drive`** — the `AgentClient` private method that consumes a transport stream and maps completion/failure to store `status`.
- **In-process runner** — `streamAgentTurnInProcess` → `@theokit/agents` `ui-message-stream-translator.ts`, which converts a thrown/agent error into a `{ type:'error', errorText }` chunk (`packages/agents/src/bridge/ui-message-stream-translator.ts:213,225`) rather than throwing.

### Architecture boundaries affected

- Stays entirely inside `packages/theo/src/client/` (the framework-agnostic client layer, `theokit/client` + `theokit/client/core`). No runtime code touched → `sdk-runtime.md` / G2 untouched (no LLM call, no loop, no storage). Per `architecture.md`, the change is within one module; no dependency-direction crossing. `ai` remains a dynamically-imported optional peer.

## Prior Art & Related Work

- **Reference in-repo — the THROWN error path is already tested:** `tests/unit/agent-client.test.ts:127` `test_send_5xx_sets_error_status` proves a *rejected* `sendMessages` sets `status='error'`. This plan adds the missing sibling: an *error chunk within a resolved* stream. Same assertion shape, different failure mode (negative-case, `testing.md § 4.1`).
- **Reference in-repo — the runner's error-chunk emission:** `packages/agents/src/bridge/ui-message-stream-translator.ts:210-225` yields `{ type:'error', errorText }` on agent/SDK error; `packages/agents/src/testing/mock-stream.ts:76-84` provides a `type:'error'` response for tests.
- **Library primitive (adopt, don't reinvent — Rule 9):** `ai@7.0.14` `readUIMessageStream({ onError, terminateOnError })` (`dist/index.d.ts:6064`) is the built-in error hook; the fix wires it rather than hand-parsing message parts.
- **Blueprint:** `knowledge-base/discoveries/blueprints/unified-agent-surface-blueprint.md` (the M41/M46 unified client design) — the store's status machine is the surface this plan completes for the error case.

## Objective

- [ ] `consumeChunkStream` captures an in-stream error chunk and rethrows it after the loop (via `ai`'s `onError` + `terminateOnError:true`).
- [ ] `AgentClient` (transport/in-process path) settles `status='error'` with `error.message === errorText` when the stream yields an error chunk — new negative-case test green.
- [ ] The Response/SSE path (`consumeUIMessageStream` → `consumeChunkStream`) surfaces the same error identically — covered by the direct consumer test.
- [ ] Zero regression: happy-path streaming test and existing `test_send_5xx_sets_error_status` stay green.
- [ ] Patch changeset for `theokit` added; `[Unreleased]` CHANGELOG updated.

## ADRs

### D1 — Surface the error by rethrowing from `consumeChunkStream` (via `onError` + `terminateOnError`), not by inspecting the reconstructed message

- **Decision:** In `consumeChunkStream`, pass `onError: (err) => { captured = err }` and `terminateOnError: true` to `readUIMessageStream`; after the `for await` loop, `if (captured) throw captured`. Let the existing `AgentClient.#drive` catch translate the throw into `status='error'` + `#error`.
- **Rationale:** Reuses `ai`'s own error hook (Rule 9 — no reinvented parser), keeps the fix in ONE shared function so BOTH the transport path (store) and the Response/SSE path (`consumeUIMessageStream`) are fixed at once (DRY / G12), and reuses the store's already-tested catch (no new status-machine code). Fail-fast/fail-loud per `error-handling.md`. `terminateOnError:true` stops reconstructing partial messages after the error (no half-rendered assistant bubble).
- **Alternatives considered:**
  - *Inspect the last reconstructed `UIMessage` for an error part in `#drive`* — rejected: the error variant is a stream *chunk*, not a stable message *part*, so there is nothing reliable to inspect after `readUIMessageStream` drops it; it also duplicates error logic into the store instead of the shared consumer, missing the SSE path (DRY violation).
  - *`onError` that throws synchronously inside the callback* — rejected: throwing from `ai`'s internal `onError` is undefined-contract and could abort mid-reduction with a partial state; capture-then-rethrow-after-loop is deterministic.
- **Consequences:** Enables any transport (`InProcessTransport`, `HttpTransport`, `ChannelTransport`) to surface stream-embedded errors uniformly. Constrains `consumeChunkStream` to always rethrow a captured error — a caller that wants to tolerate partial errors would need a new opt-in (none exists today; YAGNI).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Behavior change: `consumeChunkStream` now throws where it previously returned normally — a hypothetical caller relying on silent-swallow would break. | Low | Only 2 callers, both in-repo (store `#drive` has a catch; `consumeUIMessageStream` propagates to its caller which already expects rejection). No external caller depends on swallow (it was a bug). | client |
| `terminateOnError:true` could drop a trailing valid chunk that arrives after an error chunk. | Low | By contract the runner emits `error` as terminal (`ui-message-stream-translator.ts:213` `return`s after error); test asserts partial text before the error is still delivered via `onMessage`. | client |
| Double-surface if a future `ai` version starts throwing on `terminateOnError` AND we also rethrow. | Low | Capture-and-rethrow is idempotent w.r.t. a single error; if `ai` throws, `#drive`'s catch handles it and the post-loop rethrow is unreachable — no double emit. RED test pins current `ai@7.0.14` behavior. | client |

## Unresolved Questions

- Q1 — Does `terminateOnError:true` in `ai@7.0.14` also cause `readUIMessageStream` to throw (making the post-loop rethrow dead code), or only stop iteration? **RESOLVED (review, empirical):** `terminateOnError:true` calls `controller.error()` on the output stream, so the `for await` itself REJECTS on the error chunk — the implicit throw reaches `#drive`'s catch before the post-loop `throw streamError` runs. The post-loop rethrow is therefore **dead code under ai@7.0.14**, kept intentionally as a defensive fallback (version-robustness if a future `ai` stops rejecting under `terminateOnError`). The code comment states this accurately; the tests assert the observable outcome regardless of which mechanism fires.
- Q2 — Should the surfaced `error.message` be the raw `errorText` (provider string, e.g. "OpenRouter: 401 …") or a wrapped/typed error? For this fix: raw `errorText` (what the runner already composed) — a typed `TheoError` wrap is a separate enhancement (out of scope; would touch the runner, not the client).

## Dependency Graph

```
Phase 1 (fix + unit tests) ──▶ Phase 2 (changeset + CHANGELOG) ──▶ Final Phase (integration validation)
```

All sequential; single-file fix, no parallelism needed.

---

## Phase 1: Surface the error chunk

**Objective:** Make `consumeChunkStream` rethrow an in-stream error chunk so the store and the SSE path both surface it.

### T1.1 — Rethrow captured stream error from `consumeChunkStream`

#### Objective
Capture an error chunk via `ai`'s `onError` and rethrow it after the reconstruction loop, so a resolved stream carrying `{ type:'error', errorText }` fails the consumer instead of ending silently.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds `onError` (captures into a local) + `terminateOnError:true` to the `readUIMessageStream({ stream })` call in `consumeChunkStream`, and a `if (streamError !== undefined) throw streamError` after the loop.
2. **Why it is necessary now** — per D1 and Baseline Context, this is the single choke point shared by the store's `#drive` (transport path) and `consumeUIMessageStream` (SSE path). Fixing it here surfaces #136 for every transport at once, reusing the store's already-tested `catch`. Doing it in `#drive` instead would miss the SSE path and duplicate logic (DRY).

#### Evidence
- `packages/theo/src/client/consume-ui-message-stream.ts:63-71` — current `consumeChunkStream` calls `readUIMessageStream({ stream })` with no error hook.
- `ai@7.0.14/dist/index.js:7036` — `case "error": onError == null ? void 0 : onError(new Error(chunk.errorText)); break;` (no throw → swallow when `onError` absent).
- `packages/theo/src/client/agent-client.ts:135-138` — the `catch` that will translate the rethrow into `status='error'`.

#### Files to edit
```
packages/theo/src/client/consume-ui-message-stream.ts — add onError capture + terminateOnError + post-loop rethrow to consumeChunkStream
tests/unit/agent-client.test.ts — RED: test_send_error_chunk_sets_error_status (transport path)
tests/unit/consume-chunk-stream.test.ts — RED (NEW): consumeChunkStream rethrows on error chunk; still delivers prior messages; happy path unaffected
```

#### Deep file dependency analysis
- `consume-ui-message-stream.ts` (Baseline row 1): only `consumeChunkStream`'s body changes; `responseToChunkStream` and `consumeUIMessageStream` are untouched. Downstream: `agent-client.ts:124` and `consume-ui-message-stream.ts:22` call it — both benefit; `agent-client.ts`'s catch (Baseline row 2) does the surfacing.
- `agent-client.test.ts` (Baseline row 3): reuses `chunkStream()`/`fakeTransport`/`waitSettled`; the new test mirrors `test_send_5xx_sets_error_status` but the transport RESOLVES a stream whose last chunk is `{ type:'error', errorText }`.

#### Deep Dives
- **Data structures:** error chunk `{ type: 'error', errorText: string }`. `onError` receives `new Error(errorText)` → `error.message === errorText`.
- **Algorithm:**
  1. declare `let streamError: Error | undefined`
  2. `readUIMessageStream({ stream, onError: (e) => { streamError = e instanceof Error ? e : new Error(String(e)) }, terminateOnError: true })`
  3. `for await (const message of …) onMessage(message)`
  4. `if (streamError !== undefined) throw streamError`
- **Invariants (Baseline row 1):** `ai` stays a dynamic import; `onMessage` still fires for every pre-error reconstruction step; `responseToChunkStream`/`consumeUIMessageStream` signatures unchanged.
- **Edge cases:** stream with NO error chunk → `streamError` undefined → no throw (happy path unchanged); error chunk as the FIRST chunk → `onMessage` never fires, throw immediately; abort race → handled upstream by `#drive`'s `aborted()` guard (not this function's concern).

#### Pseudo-code / Signatures
```pseudocode
async function consumeChunkStream(stream, onMessage):
  { readUIMessageStream } = await import('ai')
  streamError = undefined
  for await (message of readUIMessageStream({
        stream,
        onError: (e) => streamError = (e instanceof Error ? e : new Error(String(e))),
        terminateOnError: true })):
    onMessage(message)
  if streamError !== undefined: throw streamError

# Example (error chunk after one text chunk)
input chunks:  [{type:'start'},{type:'text-start',id:'t0'},{type:'text-delta',id:'t0',delta:'Hi'},
                {type:'text-end',id:'t0'},{type:'error',errorText:'OpenRouter: 401 No auth'}]
effect:        onMessage fired with the 'Hi' message; then throws Error('OpenRouter: 401 No auth')
```

#### Tasks
1. Add `onError` capture + `terminateOnError:true` to the `readUIMessageStream` call in `consumeChunkStream`.
2. Add the post-loop `throw streamError` guard.
3. Write the RED store test `test_send_error_chunk_sets_error_status` in `tests/unit/agent-client.test.ts`.
4. Write the RED direct-consumer test file `tests/unit/consume-chunk-stream.test.ts`.

#### TDD
```
RED:  test_send_error_chunk_sets_error_status() [tests/unit/agent-client.test.ts]
        — fakeTransport resolves chunkStream([...text..., {type:'error', errorText:'OpenRouter: 401 No auth'}]);
          client.send(); await waitSettled(client);
          expect status === 'error' AND error.message === 'OpenRouter: 401 No auth'. FAILS today (settles 'done').
RED:  test_consumeChunkStream_rethrows_on_error_chunk() [tests/unit/consume-chunk-stream.test.ts]
        — feed a ReadableStream ending in an error chunk; expect(consumeChunkStream(...)).rejects.toThrow('...errorText...')
          AND onMessage was called for the pre-error text message. FAILS today (resolves silently).
RED:  test_consumeChunkStream_happy_path_no_throw() [tests/unit/consume-chunk-stream.test.ts]
        — text-only stream; expect resolves; onMessage called with reconstructed text. (guards against over-throwing)
GREEN: implement the onError-capture + terminateOnError + rethrow in consumeChunkStream.
REFACTOR: None expected (≤ 8 added lines in one function).
VERIFY: pnpm vitest run tests/unit/agent-client.test.ts tests/unit/consume-chunk-stream.test.ts
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

The `async/await` here is stream iteration, not shared-state concurrency; the store's stale-drive/abort race is pre-existing and covered by `test_abort_then_new_send_prevents_stale_drive_from_clobbering_status` at `agent-client.test.ts:78`, unchanged by this plan.

#### Acceptance Criteria
- [ ] `test_send_error_chunk_sets_error_status` green (status `'error'`, `error.message` == `errorText`).
- [ ] `test_consumeChunkStream_rethrows_on_error_chunk` green; pre-error `onMessage` still fired.
- [ ] `test_consumeChunkStream_happy_path_no_throw` green (no over-throwing).
- [ ] Existing `test_send_5xx_sets_error_status` + happy-path tests still green.
- [ ] Pass: lint — `eslint packages/theo/src/client/consume-ui-message-stream.ts tests/unit/consume-chunk-stream.test.ts` zero warnings.
- [ ] Pass: size — `consume-ui-message-stream.ts` stays ≤ 500 lines (currently 71).

#### DoD (Definition of Done)
- [ ] Tasks completed and validated.
- [ ] `vitest run` green for the two test files.
- [ ] `tsc --noEmit` zero errors.
- [ ] `eslint . --max-warnings=0` clean on changed files.
- [ ] File-size budget respected.

---

## Phase 2: Release plumbing

**Objective:** Record the fix for consumers.

### T2.1 — Changeset + CHANGELOG

#### Objective
Add a patch changeset for `theokit` and an `[Unreleased]` CHANGELOG entry so the fix ships and is communicated.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — writes `.changeset/fix-silent-agent-stream-error.md` (patch bump `theokit`) and a root `CHANGELOG.md` `[Unreleased] § Fixed` line referencing #136.
2. **Why it is necessary now** — Unbreakable Rule 6 (CHANGELOG discipline) + the repo's changesets flow drive the package `CHANGELOG.md` and version bump; without the changeset the fix ships unversioned/uncommunicated.

#### Evidence
- `.changeset/config.json` present (changesets configured); `packages/theo/CHANGELOG.md` head `## 0.43.1` (changeset-driven).
- `error-handling.md` — the fixed behavior is a user-visible correctness change worth a Fixed entry.

#### Files to edit
```
.changeset/fix-silent-agent-stream-error.md (NEW) — patch bump theokit, one-line summary
CHANGELOG.md — [Unreleased] § Fixed entry referencing #136
```

#### Deep file dependency analysis
- `.changeset/*.md` consumed by `changeset version` to bump `packages/theo` + write its CHANGELOG. Root `CHANGELOG.md` is maintained manually (per the repo's prior release commits).

#### Deep Dives
- Changeset frontmatter: `"theokit": patch`. Body: "Surface in-process agent stream errors: a provider failure (401/429/5xx) now sets `useAgent().error` instead of a silent dead UI (#136)."

#### Tasks
1. Create the changeset file with a `patch` bump for `theokit`.
2. Add the `[Unreleased] § Fixed` CHANGELOG line.

#### TDD
```
RED:     (none — release metadata, no executable behavior)
GREEN:   Add changeset + CHANGELOG entry.
REFACTOR: None expected.
VERIFY:  test -f .changeset/fix-silent-agent-stream-error.md && grep -q '#136' CHANGELOG.md
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] Changeset file exists with a `patch` bump for `theokit`.
- [ ] `CHANGELOG.md` `[Unreleased] § Fixed` references #136.

#### DoD (Definition of Done)
- [ ] Changeset + CHANGELOG present; `pnpm changeset status` recognizes the pending changeset (or dry equivalent).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | In-process error chunk swallowed → `useAgent().error` undefined (#136) | T1.1 | `consumeChunkStream` rethrows the captured error; store `#drive` catch sets `status='error'`+`error`. |
| 2 | Same fix must cover the HTTP/SSE path (shared consumer) | T1.1 | Fix lives in the shared `consumeChunkStream`; `consume-chunk-stream.test.ts` exercises it directly (SSE path proxy). |
| 3 | Negative-case test asserting typed error + message | T1.1 | `test_send_error_chunk_sets_error_status` + `test_consumeChunkStream_rethrows_on_error_chunk`. |
| 4 | Zero regression to happy path + existing thrown-error path | T1.1 | `test_consumeChunkStream_happy_path_no_throw` + existing `test_send_5xx_sets_error_status`/happy-path stay green. |
| 5 | Ship + communicate (changeset, CHANGELOG, ADR) | T2.1 + `## ADRs` D1 | Patch changeset + `[Unreleased] § Fixed` (#136); decision recorded in D1. |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `vitest run` green.
- [ ] Zero type errors — `tsc --noEmit`.
- [ ] Zero lint warnings — `eslint . --max-warnings=0`.
- [ ] File-size budget respected (per `rules/architecture.md`).
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6).
- [ ] Backward compatibility preserved: `consumeUIMessageStream`/`responseToChunkStream`/`consumeChunkStream` signatures unchanged; only failure behavior tightens (silent → surfaced).
- [ ] Plan-specific: the Goal's named test `test_send_error_chunk_sets_error_status` passes.
- [ ] Plan archived — move to `knowledge-base/plans/completed/` after `/review` READY_TO_MERGE + PR merged.

## Failure scenarios (when I/O external)

The client consumer does not itself perform external I/O — it consumes a stream a transport already opened. The failure being fixed IS the external-failure surfacing. Modeled at the consumer boundary:

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Agent turn stream (via any transport) | provider error mid/pre-stream → `{ type:'error', errorText }` chunk | `chunkStream([...text..., {type:'error', errorText:'OpenRouter: 401 No auth'}])` fed to `AgentClient`/`consumeChunkStream` | consumer rethrows; store `status='error'`, `error.message==errorText`; pre-error partial text already delivered via `onMessage`. |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Prove the fix works across the store + consumer and breaks nothing.

### Execution
```
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/consume-chunk-stream.test.ts
pnpm vitest run                 # full suite — no regression
tsc --noEmit                    # zero type errors
eslint . --max-warnings=0       # zero lint warnings
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm vitest run` exits 0 (targeted + full).
- [ ] Coverage ≥ 90% on `consume-ui-message-stream.ts` changed lines — `pnpm vitest run --coverage` reports the error branch covered by both new tests.
- [ ] Zero type errors — `tsc --noEmit` exits 0.
- [ ] Zero lint warnings — `eslint . --max-warnings=0` exits 0.
- [ ] Failure scenario row exercised: the error-chunk stream produces `status='error'` + matching message, asserted by `test_send_error_chunk_sets_error_status`.

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description; they do not block.
