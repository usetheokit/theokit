---
slug: m7-run-context
milestone_id: M7
created_at: 2026-07-06
goal: Give agents/tools a typed run-context, injected into every tool handler, so projectRoot is set once at the agent — matching ai-sdk/mastra/openai-agents-js, which @theokit/sdk lacks.
---

# Plan — M7: run-context / dependency injection for tools

## Cross-repo reality (from DISCOVER)

M7 spans TWO local git repos + one non-local:
- **`theokit-sdk`** (`../theokit-sdk`, separate git, `@theokit/sdk@2.18.1`): the tool-handler seam.
- **`theokit`** (this repo, `@theokit/agents`): the `defineAgent`/`@Agent` context wiring.
- **`@theokit/sdk-tools`** (non-local, published only): factories reading from context — **deferred**
  (source not available; migration is a follow-up once the seam ships).

Verification without publishing: build the SDK locally, `pnpm.overrides` it into `theokit` (the #81
pattern), prove end-to-end. READY_TO_MERGE = the coordinated pair of PRs (theokit-sdk + theokit),
both verified.

## The seam (exact, file:line)

`CustomTool.handler` **already** takes an optional 2nd arg `ctx?: { signal?: AbortSignal }` (#65). The
change WIDENS `ctx` to carry a user `context` and threads it `run → loop → dispatch → executor`.

**theokit-sdk:**
- `packages/sdk/src/types/agent-prims.ts:46` — `CustomTool.handler` ctx: `{ signal?: AbortSignal }` → `{ signal?: AbortSignal; context?: unknown }`.
- `packages/sdk/src/types/run.ts` (`RunToCompletionOptions`/stream opts, `signal?` at 143/279) — add `context?: unknown`.
- `packages/sdk/src/internal/agent-loop/tool-executors.ts:53` — `handler(call.input, { signal })` → `{ signal, context }`; executor gains a `context?` param.
- `packages/sdk/src/internal/agent-loop/tool-dispatch.ts:284` — thread `context: inputs.context` (mirrors `signal: inputs.signal`).
- `packages/sdk/src/internal/tool-dispatch/dispatch.ts:87` — `tool.handler(args)` (no ctx) → pass `{ context }`.
- `packages/sdk/src/define-tool.ts:85` — the Zod wrapper's ctx type widened (passes ctx through).
- Thread `context` from run options through the run→loop plumbing to `inputs.context`.

**theokit (`@theokit/agents`):**
- `DefineAgentConfig` + `@Agent` gain `context?: Record<string, unknown>`.
- The bridge (`agent-orchestrator`/`createSdkAgentStream`) passes `context` to the SDK run options.
- `AgentRunner.run(msg, { context })` per-run override.

## Coverage matrix

| Goal claim | Task |
|---|---|
| SDK handler ctx carries user `context`, threaded from run options | T1 (theokit-sdk, TDD) |
| SDK back-compat: single-arg + signal-only handlers unaffected | T1 (regression test) |
| `defineAgent({ context })`/`@Agent({ context })` reach the tool handler | T2 (theokit, TDD) |
| End-to-end: a tool reads `ctx.context.projectRoot`, set once at the agent | T3 (deterministic E2E, SDK-stubbed) |
| Both repos' suites green; verified via local override | T4 (gate) |

## Tasks

### T1 — SDK seam (theokit-sdk, TDD)
- RED: a test asserting a `CustomTool.handler` receives `ctx.context` provided at run options.
- GREEN: widen `agent-prims.ts` ctx type + `run.ts` options + thread `context` through
  tool-dispatch → tool-executors → handler. Regression test: signal-only + single-arg handlers still work.
- `pnpm test` (SDK) green; `pnpm build` (tsup) green.

### T2 — agents wiring (theokit, TDD)
- RED: a bridge test asserting `defineAgent({ context })` compiles to run options carrying `context`.
- GREEN: add `context` to `DefineAgentConfig` + `@Agent` + thread through the orchestrator to the SDK
  run options. Override `@theokit/sdk` to the locally-built T1 tarball.

### T3 — end-to-end (theokit, deterministic)
- A stubbed-SDK E2E (no LLM): an agent whose tool handler reads `ctx.context.projectRoot`; assert it
  receives the value declared once on the agent. Proves the mechanism, no key needed.

### T4 — gate
- theokit-sdk suite green + build; theokit `@theokit/agents` suite green + tsc 0; the E2E green
  against the overridden local SDK.

## Acceptance criteria (evidence)

- **AC-1** SDK: handler receives `ctx.context` from run options; signal-only/single-arg back-compat proven. `pnpm test` + `pnpm build` green.
- **AC-2** theokit: `defineAgent({ context: { projectRoot } })` threads to the handler; `tsc` 0.
- **AC-3** E2E: a tool reads `ctx.context.projectRoot` set once at the agent — deterministic test green.
- **AC-4** Both repos green via the local override (no publish required for verification).

## Drawbacks & risks

1. **Cross-repo release sequencing** — READY_TO_MERGE = a coordinated pair; shipping needs the SDK
   publish (@theokit/sdk@2.19+) THEN the theokit bump. Verified locally via override meanwhile.
2. **`context` typing** — start with `Record<string, unknown>` (runtime-safe, minimal); the fully-typed
   generic flow (`ctx.context` inferred) is M8's builder territory, not M7. Keep M7 the runtime seam.
3. **sdk-tools deferred** — factories reading from context is a 3rd-repo follow-up (source non-local).

## Unresolved questions

- (none) — the seam is located file:line in both repos; sdk-tools deferral is explicit.
