---
slug: agent-callable-delegation
created_at: 2026-08-15
goal: Ship createDelegateTool so an agent can delegate to a local sub-agent mid-run
---

# Plan: `createDelegateTool` — let the agent ask the framework to delegate

> **Version 1.1** — absorbed EC-1 (API key never sourced) and EC-2 (duplicate roster names) from
> [`reviews/agent-callable-delegation-edge-cases-2026-08-15.md`](../reviews/agent-callable-delegation-edge-cases-2026-08-15.md),
> plus its three SHOULD-TEST items. Derived from
> [`discoveries/blueprints/theocode-baseline-gaps-blueprint.md`](../discoveries/blueprints/theocode-baseline-gaps-blueprint.md)
> (verdict SHIPPABLE), whose single `absorb` finding this closes.

## Goal

Ship `createDelegateTool` from `@theokit/agents/tools` so an agent can delegate to a local
sub-agent mid-run, measured by `packages/agents/tests/unit/delegate-tool.test.ts` passing with
every assertion green and the factory reachable from the subpath barrel.

## Context

The discovery blueprint measured the framework's agent-facing surface: `@theokit/agents/tools`
ships **23** tool factories (read/write/patch/glob/search/git/web/shell/question/todo/plan/…), and
`@theokit/agents` ships `delegate()`, `delegateWithScoring()`, `delegateBackground()` and `Squad`.

Exactly one capability is app-facing without an agent-facing counterpart: **local sub-agent
delegation**. The framework can delegate; the agent cannot ask it to. The only delegation tool is
`createA2ATool`, whose target is a **remote** A2A peer over the network — a different transport, a
different trust boundary, and no inheritance of the parent's tools, budget or authority.

The measured consequence: TheoCode wrote `packages/agent/src/delegation/squad.ts` (87 LoC) to close
it. The generic half of that file is the tool wrapper; the product half is `TEAM_ROLES`.

**Honesty note carried forward from the blueprint.** The first draft of the discovery claimed three
missing wrappers. Two dissolved under re-measurement — `createInteractiveShellTool` is a pure
delegation to a shipped factory, and `createUpdateGoalTool` is 15 lines of `Tool.create` plus 35
lines of product policy. Only this one survived. That is why this plan closes one gap and not three.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last touch | Why it is in scope |
|---|---:|---|---|
| `packages/agents/src/tools/delegate-tool.ts` | **(NEW)** | — | The factory |
| `packages/agents/src/tools-entry.ts` | 130 | current HEAD `c9735140` | The `./tools` subpath barrel — where the 23 existing factories are re-exported |
| `packages/agents/tests/unit/delegate-tool.test.ts` | **(NEW)** | — | TDD RED then GREEN |
| `CHANGELOG.md` | — | — | Unbreakable Rule 6 |

### Current callers / dependents (measured 2026-08-15)

| Symbol | Defined at | Shape |
|---|---|---|
| `delegate` | `packages/agents/src/bridge/agent-orchestrator.ts:188` | `(spec: SubAgentSpec, message: string, opts?: DelegateOptions) => Promise<DelegationResult>` |
| `SubAgentSpec` | `.../agent-orchestrator.ts:179` | `{ name, compiled, strategy?, maxIterations? }` |
| `DelegationPort` | `.../bridge/delegation-scoring.ts:26` | `{ run(message: string): Promise<DelegationResult> }` |
| `DelegationTarget` | `.../delegation-scoring.ts:31` | `SubAgentSpec \| DelegationPort` |
| `DelegationBudgetExceededError`, `DelegationTimeoutError`, `DelegationError` | `packages/agents/src/` | typed errors already shipped |
| `Tool.create` | re-exported at `packages/agents/src/index.ts:59` from `@theokit/sdk` | `({name, description, inputSchema, handler}) => CustomTool` |
| the 23 factories | `packages/agents/src/tools-entry.ts:78,121` | re-exported from `@theokit/sdk-tools` |

### Architecture boundaries affected

The 23 existing factories live in `@theokit/sdk-tools`. `createDelegateTool` **cannot** join them:
`delegate()` is defined in `@theokit/agents` (framework core), and an SDK package importing the
framework inverts the dependency direction G1 declares. The factory therefore lives in
`packages/agents/src/tools/` and is re-exported through the same `./tools` subpath, so consumers see
one uniform surface regardless of which side of the seam a factory is implemented on.

### Domain glossary

- **Sub-agent delegation** — running a second compiled agent within the parent's run, inheriting the parent's tools, budget clamp and authority.
- **A2A** — agent-to-agent over a network transport; a remote peer, not a local sub-agent.
- **Port** — `DelegationPort`, the `{run(message)}` seam that makes delegation testable without an LLM.

## Prior Art & Related Work

- [`discoveries/blueprints/theocode-baseline-gaps-blueprint.md`](../discoveries/blueprints/theocode-baseline-gaps-blueprint.md) — the measurement this plan implements.
- TheoCode `packages/agent/src/delegation/squad.ts` — the only existing implementation; read for shape, not copied (`rules/reference-provenance.md`).
- `packages/agents/src/a2a/a2a-client.ts` `createA2ATool` — the in-repo precedent for "delegation exposed as a tool", over a different transport. Its input-shape and error-surfacing choices are the house style this factory matches.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | `^4` | npm | Input schema; already the framework's schema language (G3) |
| `@theokit/sdk` | `^4.52.1` | npm | `Tool.create` — already an optional peer |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | Parsimony rung 4: every primitive needed (`delegate`, `Tool.create`, `zod`, typed errors) is already installed | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Objective

One factory, matching the shape of the 23 that exist, that turns the framework's already-shipped
`delegate()` into a tool an agent may call — without re-deriving any of the safety `delegate()`
already owns.

## ADRs

### D1 — The agent picks a target from a closed enum, never a free string

**Decision:** the input schema is `{ agent: z.enum([...names]), task: z.string().min(1) }`, with the
enum built from the caller-supplied roster at factory time.

**Rationale:** a free-form `agent: string` lets the model name a sub-agent that does not exist; the
failure then surfaces at dispatch, one layer below where it can be explained. A closed enum makes
the invalid state unrepresentable at the schema boundary and puts the roster in the tool description
the model reads. `createA2ATool` constrains its target the same way. **Alternatives rejected:**
(a) *free string + runtime lookup* — moves a compile-time-shaped constraint to runtime for no gain;
(b) *one tool per sub-agent* — N tools inflate the model's tool list and the roster is dynamic.

### D2 — Accept `DelegationTarget`, not `SubAgentSpec`

**Decision:** the roster accepts `DelegationTarget` (`SubAgentSpec | DelegationPort`).

**Rationale:** `DelegationPort` is the DIP seam the framework already declares
(`delegation-scoring.ts:31`), and it is what makes this factory unit-testable without an API key or
a network call. Reusing it is parsimony rung 4 — the abstraction exists, do not mint a second one.
**Alternatives rejected:** (a) *`SubAgentSpec` only* — forces every test to compile a real agent and
carry a credential, which is how a factory ends up with no tests; (b) *a new `DelegateFn` injection
parameter* — a second seam over the same joint, which G12 (DRY) forbids.

### D2b — The roster is `{ name, target }`, and credentials are supplied at factory time

**Decision:** the roster is `readonly { name: string; target: DelegationTarget }[]`, and the factory
takes `defaults: DelegateOptions` whose `apiKey` is **required** whenever any entry is a
`SubAgentSpec`. Both are validated at factory time.

**Rationale — absorbed from EC-1 and EC-3.** `DelegationPort` is `{run(message)}` and carries no
`name`, so a port roster has nothing for D1's enum to enumerate; pairing the name with the target
removes a type guard from every use site. And `delegate()` calls `requireApiKey`
(`agent-orchestrator.ts:128`), throwing `DelegationError` when `opts.apiKey` is empty — a factory
that passes `{}` is dead on the real path *while its tests stay green*, because D2's port double
never reaches that line. Validating at construction turns a first-call runtime failure into a
startup one. **Alternatives rejected:** (a) *resolve the key inside the handler from the
environment* — hides a credential dependency the app should declare, and `resolveAgentCredential`
is the app's call to make, not this factory's; (b) *let it fail at call time* — the failure then
reaches the model as a tool error it will try to reason about, which is the worst reader.

### D3 — Delegation failures return structured JSON to the model; they do not throw

**Decision:** `DelegationBudgetExceededError`, `DelegationTimeoutError` and `DelegationError` are
caught and returned as `{ ok: false, error: <code>, … }`. Anything else propagates.

**Rationale:** a thrown error inside a tool handler ends the parent's turn; a budget exhaustion is
information the model can act on (delegate less, or finish itself). This is not swallowing —
`rules/error-handling.md` forbids that, and nothing is silenced: the typed error's identity is
carried into the payload as a stable `error` code, and unknown errors still propagate loudly.
**Alternatives rejected:** (a) *let everything throw* — turns a recoverable budget signal into a
dead run; (b) *catch everything* — hides genuine defects (a bug in the roster, a null spec) behind
a message the model will try to reason about.

### D4 — The factory adds no budget, timeout or authority logic of its own

**Decision:** the handler resolves a name and calls `delegate()`. Nothing else.

**Rationale:** `delegate()` already merges parent tools, clamps the budget and propagates authority
(`agent-orchestrator.ts:202`). A second implementation of any of those in the tool layer is exactly
the G12 violation that produces two owners of one rule, which then diverge in silence. Parsimony
rung 6: the minimum that works. **Alternatives rejected:** (a) *a `maxDepth` guard in the tool* —
delegation depth is `delegate()`'s to own, and TheoCode's `withDelegationCap` is already covered by
the shipped `DelegationBudgetExceededError`/`DelegationTimeoutError`; (b) *a retry wrapper* —
YAGNI (G11), nobody asked, and a retry over a budget failure is wrong by construction.

## Drawbacks & Risks

| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R1 | An agent given a delegate tool can recurse — a sub-agent that also holds the tool delegates again | HIGH | `delegate()` clamps the parent budget into the child, so recursion terminates on budget rather than on stack. Asserted by a test that delegates through a port returning a second delegation | plan |
| R2 | The tool description is model-facing copy; a vague one produces misuse (delegating trivia) | MEDIUM | Description states cost explicitly and names when *not* to reach for it, following `createA2ATool`'s precedent | plan |
| R3 | Placement in `packages/agents` while 23 siblings live in `@theokit/sdk-tools` splits the implementation across two repos | MEDIUM | Deliberate and documented (§ Baseline Context): the alternative inverts G1. The `./tools` barrel keeps the consumer-facing surface uniform | plan |
| R4 | `zod` enum needs ≥1 member; an empty roster is representable at the type level | MEDIUM | Reject an empty roster at factory time with a typed error — a tool offering no targets is a defect, not a configuration | plan |
| R5 | Two roster entries sharing a name collapse in the enum; lookup then resolves non-deterministically (EC-2) | HIGH | Reject duplicate names at factory time, the same rule `Toolset` already enforces as `duplicate_tool`. Silent wrong-agent dispatch is worse than a crash because it looks like it worked | plan |
| R6 | The R1 recursion bound holds only when the caller passes `budget`/`parentBudgetRemaining` — both optional in `DelegateOptions` (EC-6) | MEDIUM | Documented, not fixed: a depth counter here would put a second owner on a rule `delegate()` owns (D4/G12). The factory docblock states the guarantee is conditional rather than implying it is absolute | plan |

## Unresolved Questions

- Should `delegateWithScoring` also get a tool? Deferred — no measured demand; the blueprint found one implementation of plain delegation and none of scored delegation in a tool. Revisit with evidence (G11).

## Dependency Graph

```
T1 (RED: failing tests) ──> T2 (GREEN: factory) ──> T3 (barrel + wiring) ──> T4 (CHANGELOG)
```

All tasks are sequential; there is nothing to parallelise in a single-file feature.

## Phase 0: The factory

### T0.1 — `createDelegateTool`

#### Why this step

**Action:** add `packages/agents/src/tools/delegate-tool.ts` exporting `createDelegateTool`, and
re-export it from `tools-entry.ts`.

**Reasoning:** the blueprint measured one capability that is app-facing without an agent-facing
counterpart (§ Context). D2 fixes the seam to the `DelegationPort` the framework already declares,
so the factory is testable without a credential; D4 keeps it thin so `delegate()` stays the single
owner of delegation safety. Baseline Context § Architecture boundary fixes the placement.

#### Files to edit

- `packages/agents/src/tools/delegate-tool.ts` **(NEW)** — the factory, ≤ 120 LoC (G6 budget 500)
- `packages/agents/src/tools-entry.ts` — one re-export line
- `packages/agents/tests/unit/delegate-tool.test.ts` **(NEW)** — the suite

#### Deep file dependency analysis

`delegate-tool.ts` imports `delegate` + `SubAgentSpec` from `./bridge/agent-orchestrator.js`,
`DelegationTarget`/`DelegationPort` from `./bridge/delegation-scoring.js`, the three delegation
errors, `Tool` from `@theokit/sdk`, and `z` from `zod`. All are intra-package or already-declared
dependencies; no new edge is introduced in the G1 DAG.

#### TDD

**RED — write these first, watch them fail:**

- `test_builds_a_tool_whose_schema_enumerates_the_roster` — the emitted `inputSchema` lists exactly the roster's names.
- `test_delegates_to_the_named_target_and_returns_its_text` — a `DelegationPort` double records the message it received; the handler returns the port's result.
- `test_an_agent_name_outside_the_roster_is_rejected_by_the_schema` — NEGATIVE: parsing `{agent:'nope'}` fails, and the failure names the field.
- `test_a_budget_exhaustion_returns_structured_json_not_a_throw` — NEGATIVE: a port throwing `DelegationBudgetExceededError` yields `{ok:false,error:'delegation_budget_exceeded'}`; the handler does not reject (D3).
- `test_a_timeout_returns_structured_json_not_a_throw` — NEGATIVE: same for `DelegationTimeoutError`.
- `test_an_unexpected_error_propagates` — NEGATIVE: a port throwing a plain `Error` rejects, proving D3 catches by type and does not swallow.
- `test_an_empty_roster_is_refused_at_factory_time` — NEGATIVE, R4: constructing with `[]` throws a typed error naming the cause.
- `test_recursion_terminates_on_budget_not_on_stack` — R1: a port that itself delegates once more resolves rather than overflowing.
- `test_duplicate_roster_names_are_refused_at_factory_time` — NEGATIVE, EC-2/R5: two entries named `worker` throw a typed error naming the collision.
- `test_a_spec_roster_without_an_api_key_is_refused_at_factory_time` — NEGATIVE, EC-1: constructing with a `SubAgentSpec` and no `defaults.apiKey` throws at construction, not at the model's first call.
- `test_an_empty_task_is_rejected_by_the_schema` — EDGE, EC-4: `min(1)` is pinned so a future schema edit cannot silently drop it.
- `test_the_result_is_serialised_for_the_model` — NEGATIVE, EC-5: the handler returns a `string` carrying the sub-agent's text, never a stringified object shell (`CustomTool.handler` is `string | Promise<string>`; `delegate()` resolves an object).

**GREEN — parsimony ladder walked before writing:** rung 1 the need is measured (blueprint); rung 2–3 no stdlib/platform equivalent; **rung 4 reuse** `delegate`, `DelegationPort`, `Tool.create`, the three typed errors, `zod` — all installed; rung 5 not one line (schema + roster + error mapping); rung 6 the minimum that satisfies RED.

**REFACTOR:** extract the error→payload mapping only if it exceeds one `switch`; do not pre-extract.

#### Concurrency tests

`(none — single-threaded)`. The handler awaits one `delegate()` call and holds no shared mutable
state; the roster is frozen at factory time.

#### Acceptance criteria

- `pnpm --filter @theokit/agents test -- delegate-tool` exits 0 with 12/12 assertions passing.
- `node -e "import('@theokit/agents/tools').then(m=>process.exit(m.createDelegateTool?0:1))"` exits 0.
- `delegate-tool.ts` ≤ 120 LoC; every function ≤ 50 LoC (G6).
- No `as` assertion except from `unknown` (G3).
- The factory has ≥ 1 test exercising it (G7).

#### DoD

```bash
pnpm --filter @theokit/agents test -- delegate-tool
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx eslint packages/agents/src/tools/delegate-tool.ts --max-warnings=0
```

### T0.2 — CHANGELOG

#### Why this step

**Action:** add an `Added` entry under `[Unreleased]` in the root `CHANGELOG.md`.

**Reasoning:** Unbreakable Rule 6 — a change not in the changelog did not happen. The root changelog
is the one the stop hook checks; `changeset version` writes only the package changelog.

#### Files to edit

- `CHANGELOG.md`

#### TDD

`(n/a — documentation)`. Enforced by the stop hook, not by a unit test.

#### Concurrency tests

`(none — single-threaded)`. Editing a markdown file touches no shared runtime state.

#### Acceptance criteria

- `CHANGELOG.md` contains exactly one new line under `[Unreleased] § Added` naming `createDelegateTool`, and `grep -A6 '## \[Unreleased\]' CHANGELOG.md | grep -ci delegate` returns `1`.

#### DoD

```bash
grep -A6 '## \[Unreleased\]' CHANGELOG.md | grep -i delegate
```

## Coverage Matrix

| Requirement (from the blueprint) | Task |
|---|---|
| GAP-1: agent cannot ask the framework to delegate to a local sub-agent | T0.1 |
| Destination is `theokit core`, not `@theokit/sdk-tools` (G1) | T0.1 § Files to edit + Baseline Context |
| Reuse `delegate()`'s budget/authority rather than re-derive (D4) | T0.1 TDD `test_recursion_terminates_on_budget_not_on_stack` |
| Typed-error discipline at the boundary (D3, `rules/error-handling.md`) | T0.1 TDD three NEGATIVE error tests |
| Credential sourced at factory time, not first call (EC-1) | T0.1 TDD `test_a_spec_roster_without_an_api_key_is_refused_at_factory_time` |
| Duplicate roster names refused (EC-2) | T0.1 TDD `test_duplicate_roster_names_are_refused_at_factory_time` |
| Handler returns a string, not an object (EC-5) | T0.1 TDD `test_the_result_is_serialised_for_the_model` |
| Changelog discipline (Rule 6) | T0.2 |

**Coverage: 8/8 (100%)**

## Failure scenarios

`(none — no external I/O touched)`. The factory performs no HTTP, database, queue or filesystem
call; `delegate()` owns the provider I/O, and the tests inject a `DelegationPort` double. The
error-path tests above cover the failure modes that reach this layer.

## Global Definition of Done

- [ ] `pnpm --filter @theokit/agents test` green
- [ ] `npx tsc --noEmit` green for src and test projects
- [ ] `npx eslint packages/ --max-warnings=0`
- [ ] `knip` reports 0 unused exports (G7)
- [ ] `dependency-cruiser` reports 0 cycles (G1)
- [ ] `CHANGELOG.md` `[Unreleased]` updated (Rule 6)
- [ ] `/code-quality` verdict ∈ {PASS, PASS_WITH_CAVEATS}

## Final Phase: Integration Validation (MANDATORY)

Run the full gate chain — typecheck, lint, test, build, depcruise, knip — over the whole monorepo,
not only the touched package. The plan is not complete until every gate passes.
