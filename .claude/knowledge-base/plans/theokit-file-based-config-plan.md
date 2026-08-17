---
slug: theokit-file-based-config
created_at: 2026-07-14
goal: Enable a theokit agent to opt into full `.theokit/` file-based config via a `.settingSources([...])` builder method that flows through to the SDK's `local.settingSources` + app-root `cwd`, independent of inline `.skills()`.
---

# Plan: theokit file-based config (`.theokit/` via `settingSources`)

> **Version 1.1** (absorbed the 2026-07-14 edge-case review: EC-1 config-root cwd, EC-2 safe showcase mcp/hooks, EC-3/4/5 tests) — The `@theokit/sdk@3.5.0` runtime already discovers a complete `.theokit/` file-based config (skills, subagents, hooks, MCP, context, cron) when a code-created agent passes `local.settingSources`. The theokit framework wires this only PARTIALLY: it injects `settingSources: ['project']` **only when the agent declares inline `.skills()`**, and that injection **overwrites `cwd`** so discovery does not reliably point at the app root. This plan adds an explicit, opt-in `.settingSources([...])` builder method on `agent()` (an Axis-A "SWAP" value per the `agent-dynamic-config` blueprint) that merges into `Agent.create({ local })` alongside an app-root `cwd`, decoupled from the skills gate — and proves it end-to-end by giving `apps/showcase` a real `.theokit/` config that the agent discovers in a real browser. Outcome: a theokit app author drops files under `.theokit/` and the running agent picks them up, config-as-git.

## Goal

> Enable a theokit agent author to opt into full `.theokit/` file-based config via a `.settingSources([...])` builder call that flows to the SDK's `local.settingSources` + app-root `cwd` independent of inline skills, measured by the new integration test `test_setting_sources_flows_to_agent_create_with_cwd` passing AND the showcase agent discovering a file-based skill via `agent.skills.list()` in a real-browser dogfood.

## Context

The user validated the SDK-3 adoption and asked to "evolve" TheoKit with file-based config exactly as the SDK documents it (`Agent.create({ local: { settingSources: ["project"] } })` reading `.theokit/`). Investigation (this session) found the capability is **already fully in `@theokit/sdk@3.5.0`** — `SettingSource = "project" | "user" | "team" | "mdm" | "plugins" | "all"` (`../theokit-sdk/packages/sdk/src/types/agent.ts:28`), with runtime loaders for every file type (`skills-manager.ts`, `subagents-loader.ts`, `hooks-executor.ts`, `context-manager.ts`, cron `store.ts`). The gap is in the theokit bridge: `packages/agents/src/bridge/sdk-adapter-create-options.ts:43` injects `options.local = { settingSources: ['project'] }` ONLY inside `if (compiled.skills)`, and the object literal drops any `cwd`. So an agent that wants hooks/mcp/subagents/context/cron from `.theokit/` — but no inline skill — gets no discovery at all, and even the skills path may not point at the app root. The design is anchored by the `agent-dynamic-config` blueprint: `settingSources`/`cwd` are **Axis A (SWAP)** values → a declaration-level options value that **merges over defaults**, not a resolver.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/agent-builder.ts` | 195 | `d186cb10` (2026-07-14) | The fluent `agent()` builder — type-state chain compiling to `AgentDefinition` | Existing methods (`.skills()`, `.tool()`, `.context()`, `.conversationStorage()`, …) keep their signatures; `.build()` stays the terminal |
| `packages/agents/src/bridge/agent-compiler.ts` | 249 | `adb08ca6` (2026-07-13) | Compiles `@Agent`/builder metadata → `CompiledAgentOptions` (the adapter's input) | `CompiledAgentOptions` shape is additive-only; existing fields untouched |
| `packages/agents/src/bridge/sdk-adapter-create-options.ts` | 105 | `ceb9890d` (2026-07-07) | Projects M8 compiled fields → `Agent.create()` options (`skills`/`context`/`mcpServers`/`local`) | The skills→`settingSources:['project']` back-compat behavior must not regress; `mcpServers` forwarding (#89) stays |
| `packages/theo/src/server/agent/mount-agent.ts` | 127 | `f3c022bc` (2026-07-12) | The single runtime entry that creates + streams the SDK agent per HTTP request | Signature is public-ish within theo; add `projectRoot` param additively |
| `packages/theo/src/vite-plugin/agent-middleware.ts` | 248 | `f3c022bc` (2026-07-12) | Dev-server agent route → `mountAgent` (`:233`) | Knows `opts.projectRoot`; pass it through |
| `packages/theo/src/cli/commands/start/handlers.ts` | 362 | `f3c022bc` (2026-07-12) | Prod `theokit start` agent serving → `mountAgent` | Pass the resolved root through |
| `packages/agents/src/bridge/sdk-adapter.ts` | 695 | `f61b77f3` (2026-07-14) | The SDK bridge; `:656` merges `overrides.cwd` | **Already over the 500 LoC budget — do NOT grow it; T2.2 puts the cwd default in `mount-agent.ts` so this file is unchanged** |
| `packages/agents/tests/integration/m8-adapter-wiring.test.ts` | ~130 | (mock updated this session) | Asserts compiled decorators reach `Agent.create()` (T4.1) | Existing assertions stay green |
| `apps/showcase/agents/chat.ts` | 30 | (session) | The showcase agent — the dogfood surface | Still `export default agent()…build()`; SDK-3 API |
| `apps/showcase/.theokit/skills/…` etc. (NEW) | 0 | — | (file-based config to be created) | — |

Every file in a task's `#### Files to edit` appears here.

### Current callers / dependents

- **Symbol:** `assembleM8CreateOptions(compiled)` in `sdk-adapter-create-options.ts`
  - **Callers (production):** `packages/agents/src/bridge/sdk-adapter.ts` (imports `assembleM8CreateOptions` — the sole projector into `Agent.create`)
  - **Callers (tests):** `packages/agents/tests/integration/m8-adapter-wiring.test.ts`
  - **External (other repos):** no — internal bridge symbol.
- **Symbol:** `agent()` builder return (the `AgentBuilder` interface) in `agent-builder.ts`
  - **Callers (production):** every `agents/*.ts` in apps + templates (`export default agent()…build()`); showcase `agents/chat.ts`
  - **Callers (tests):** `packages/agents/tests/unit/*builder*`, `define-agent-skills.test.ts`
  - **External:** yes — it is the public authoring API (`@theokit/agents`), so a NEW method is additive/back-compat only.
- **Symbol:** `CompiledAgentOptions` in `agent-compiler.ts`
  - **Callers (production):** `sdk-adapter.ts`, `sdk-adapter-create-options.ts`, `agent-orchestrator.ts`
  - **Callers (tests):** compiler unit tests.

### Domain glossary

- **`settingSources`** — SDK `LocalOptions` field; which config roots the SDK discovers (`"project"` = `.theokit/` under `local.cwd`; `"user"` = `~/.theokit/`).
- **`.theokit/` file-based config** — the six discoverable file types: `skills/<n>/SKILL.md`, `agents/<n>.md` (subagents), `hooks.json`, `mcp.json`, `context/<n>.md`, `cron/jobs.json`.
- **Axis A (SWAP)** — `agent-dynamic-config` blueprint term: a value held at call/declaration time (model, cwd, settingSources) resolved by **merging over static defaults** (vs Axis B, a resolver).
- **`assembleM8CreateOptions`** — the projector that turns compiled decorator/builder metadata into `Agent.create()` args.
- **`mountAgent`** — the single framework runtime entry that creates + streams the SDK agent for an HTTP request.

### Architecture boundaries affected

- `packages/agents` (the SDK bridge) → `@theokit/sdk` (runtime). Per `sdk-runtime.md` / `system-design-guardrails.md` G2 + ADR-0040: theokit is **home/boundary** — it only wires `local.settingSources` + `cwd` INTO the SDK's `Agent.create`; the SDK owns discovery + hook execution. No new loader, no reimplementation (G2 grep guard stays zero).
- No cross-package cycle introduced (agents already depends on sdk; G1 DAG unchanged).

## Prior Art & Related Work

- **Internal blueprint:** `knowledge-base/discoveries/blueprints/agent-dynamic-config-blueprint.md` — §"The core finding — config has TWO axes" + §"The dominant pattern (the recommendation)". `settingSources`/`cwd` are **Axis A (SWAP)** → declaration-level options value that **merges over defaults** (Spring AI `ChatOptions`, Pydantic `run(...)`, OpenAI `RunConfig`). This plan applies that recommendation: a `.settingSources([...])` builder value, merged into `local`, NOT a resolver.
- **Patterns skill checked:** `skills/theokit-http-decorators-pattern-from-nestjs-patterns` — description scopes it to `@theokit/http` decorator bridges (`defineRoute`, `@UseGuards`), NOT agent file-config; **not applicable**, no keyword overlap with `settingSources`/`.theokit`/file-based config. Not cited (no override needed).
- **External:** the SDK's own `settingSources` contract (`../theokit-sdk/packages/sdk/src/types/agent.ts:28-39`) + the file-based-config documentation the user supplied.

## Objective

- [ ] Add `.settingSources(sources: SettingSource[])` to the `agent()` builder (type-state preserved; additive).
- [ ] Compile it into `CompiledAgentOptions.settingSources` (additive field).
- [ ] In `assembleM8CreateOptions`, project `settingSources` into `options.local` **merged with** cwd (never overwrite), **decoupled** from the `compiled.skills` gate, while preserving the skills→`['project']` back-compat default when `.settingSources()` is unset.
- [ ] Ensure the framework sets `local.cwd` to the app root at the agent-create boundary so `.theokit/` resolves.
- [ ] Give `apps/showcase` a real `.theokit/` config (≥ a skill, a subagent, `hooks.json`, `mcp.json`, a context file, `cron/jobs.json`) and `.settingSources(['project'])` on its agent.
- [ ] Prove end-to-end in a real browser: the showcase agent discovers the file-based skill (visible via a run + `agent.skills.list()` evidence), zero console errors.

## ADRs

### D1 — Opt-in surface = a `.settingSources([...])` builder method (declaration-level Axis-A value)
- *Decision:* expose `settingSources` as a fluent builder value on `agent()`, typed `SettingSource[]` (re-exported from the SDK). When unset, current behavior is preserved (skills declared → `['project']`); when set, the declared sources win.
- *Rationale:* the `agent-dynamic-config` blueprint classifies `settingSources`/`cwd` as **Axis A (SWAP)** → a value merged over defaults, not a resolver (KISS). A per-agent method is the most discoverable, back-compat, and testable surface. `.theokit/` is the app's OWN repo, so an explicit opt-in call is informed consent for the hooks-shell risk (see D5).
- *Alternatives considered:* (a) **always-on `['project']`** for every agent — REJECTED: hooks execute shell (`hooks-executor`), silently enabling shell policy on every agent is a security surprise (G10 honesty). (b) **`defineConfig({ agents: { settingSources } })` global flag only** — REJECTED: less discoverable, all-or-nothing across agents, and the builder is where per-agent authoring already lives (DRY with `.skills()`/`.context()`).
- *Consequences:* one new additive method; the app opts in per agent; back-compat preserved. Constrains: `SettingSource` type now crosses the `@theokit/agents` public surface (re-export from SDK — single source of truth, G3).

### D2 — Merge `settingSources` into `local`, never overwrite `cwd`; default `cwd` to the framework-RESOLVED project root (EC-1), not `process.cwd()`
- *Decision:* `assembleM8CreateOptions` builds `options.local` by spread-merge (`{ ...options.local, ...(settingSources ? { settingSources } : {}), ...(cwd ? { cwd } : {}) }`); and the agent-create boundary (`mountAgent`) passes the **framework's already-resolved `projectRoot`** as `cwd` when none is supplied. `process.cwd()` is only a last-resort fallback (e.g. an out-of-band caller with no resolved root).
- *Rationale:* the current literal `options.local = { settingSources: ['project'] }` (`:43`) drops cwd, so discovery uses the SDK default cwd — unreliable. **EC-1:** `process.cwd()` is NOT guaranteed to be the app root (`cd sub && theokit dev ../..`, monorepo task runners, IDE launchers) → silent "discovers nothing". The framework already computes `projectRoot` in the vite plugin (`agents-typed-client.ts:53`); thread it through `mountAgent` (`agent-middleware.ts:233`) to `local.cwd`. Merge is the Axis-A "merge over defaults" contract from the blueprint.
- *Alternatives considered:* (a) blind `process.cwd()` — REJECTED (EC-1): not reliably the app root → silent empty discovery (G10). (b) leave cwd to the SDK default — REJECTED: same silent-fail. (c) require the author to pass cwd — REJECTED: ceremony; the framework knows the root.
- *Consequences:* discovery is reliable against the real app root; a per-run `cwd` override still merges last (wins). Constrains: `mountAgent` gains a `projectRoot` argument (threaded from the vite plugin / `theokit start` handler — both already know it).

### D3 — Decouple `settingSources` injection from the `compiled.skills` gate
- *Decision:* project `settingSources` whenever `compiled.settingSources` is set (or, for back-compat, `['project']` when `compiled.skills` is set and `settingSources` is unset) — so hooks/mcp/subagents/context/cron discovery no longer requires an inline skill.
- *Rationale:* the six file types are independent; gating all of them on inline skills (`:43`) is an accidental coupling (SRP). The blueprint's Axis-A value is orthogonal to skills.
- *Alternatives considered:* keep the skills gate and tell authors to add a dummy skill — REJECTED: cargo-cult, violates KISS + honest enforcement (G10).
- *Consequences:* an agent with only `.theokit/hooks.json` + `.settingSources(['project'])` works. Constrains: the back-compat branch must stay so existing skills-only agents are byte-unchanged.

### D4 — SDK owns discovery + execution; theokit only wires `local` (G2 / ADR-0040)
- *Decision:* no new file loader, no hook executor, no MCP launcher in `packages/`. theokit sets `local.settingSources` + `cwd` and hands to `Agent.create`.
- *Rationale:* `sdk-runtime.md` INQUEBRÁVEL + `system-design-guardrails.md` G2. File discovery + hook shell execution are runtime — SDK-owned. This is home/boundary wiring (ADR-0040).
- *Alternatives considered:* re-read `.theokit/` in theokit to pre-validate — REJECTED: duplicates the SDK, DRY/G2 violation; the SDK already raises `ConfigurationError` loudly on malformed files.
- *Consequences:* the G2 grep guard (`openrouter.ai|api.openai.com|…`) + "no conversation/skill store outside SDK" stays zero.

### D5 — Hooks-shell security posture: opt-in + documented, not blocked
- *Decision:* enabling `settingSources: ['project']` enables the SDK's hooks discovery, which runs shell commands from `.theokit/hooks.json`. This ships as **explicit opt-in** (D1) with a security note in the DEEP DIVE docs; theokit does not add a second gate.
- *Rationale:* `.theokit/` is the app's own version-controlled repo; the author calling `.settingSources(['project'])` is informed consent, mirroring the SDK's own opt-in design. A second theokit gate would be redundant ceremony (KISS) and imply theokit validates hook safety (it does not — G10 honesty).
- *Alternatives considered:* a separate `allowHooks` flag — REJECTED (YAGNI until a consumer asks; the SDK's `settingSources` granularity + read-only default already scopes risk).
- *Consequences:* documented risk; no code gate. Constrains: docs MUST state that project hooks execute shell.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Enabling `['project']` enables shell-executing hooks from `.theokit/hooks.json` | Medium | Explicit per-agent opt-in (D1/D5) + DEEP DIVE security note; default OFF | framework |
| `SettingSource` type now re-exported from `@theokit/agents` → a public-surface addition tied to the SDK type | Low | Re-export the SDK type (single source of truth, G3); no local copy | framework |
| Wrong `cwd` → silent "discovers nothing" | Medium | D2 merge + app-root default + an integration test asserting cwd is set; `agent.skills.list()` evidence in the browser dogfood | framework |
| Showcase `.theokit/` files add example surface that can rot | Low | Keep minimal (one of each type), covered by a scaffold/real test asserting discovery | framework |

## Unresolved Questions

- Should `.settingSources()` also accept `'user'` (`~/.theokit/`) in the showcase demo? — Deferred: the demo uses `['project']` only (repo-local, deterministic for the dogfood); `'user'` is supported by passing it through but not demonstrated. (Not blocking.)
- Whether to also expose `settingSources` on `defineConfig` for app-wide default — Deferred to a follow-up if a second agent needs it (YAGNI; the builder covers the current case).

## Failure scenarios

The plan touches filesystem discovery (external I/O, delegated to the SDK) — scenarios the tests cover:

- **Malformed `.theokit/skills/*/SKILL.md`** — the SDK raises `ConfigurationError` (fail-loud, never silent). theokit does not swallow it; an integration test asserts the error propagates (not silently dropped). Expected: the run surfaces a typed error, no partial-silent success.
- **`.theokit/` absent** — `settingSources: ['project']` with no files ⇒ no discovered config, agent runs on inline config only (no throw). Test asserts a `.settingSources(['project'])` agent with no `.theokit/` still creates + streams.
- **Wrong cwd** — covered by D2's test (`local.cwd` asserted = app root).

## Phases

### Phase 1 — Builder + compile the `settingSources` value

#### Task T1.1 — `.settingSources()` on the `agent()` builder

**Why this step.** *Action:* add a fluent `.settingSources(sources)` method returning the builder (type-state preserved). *Reasoning:* per D1 + the `agent-dynamic-config` blueprint, `settingSources` is an Axis-A value authored on the declaration; the builder is where `.skills()`/`.context()` already live (DRY).

##### Files to edit
- `packages/agents/src/bridge/agent-builder.ts` — add the method to the `AgentBuilder` interface + the `makeBuilder` impl; re-export `SettingSource` from `@theokit/sdk`.

##### TDD
- RED: `test_builder_settingSources_carries_to_config` — `agent().settingSources(['project']).build()` ⇒ the built `AgentDefinition` carries `settingSources: ['project']`. Assertion: `expect(def.settingSources).toEqual(['project'])`.
- GREEN: store the value in the builder config; thread into `.build()`.
- REFACTOR: keep the method one-liner (mirrors `.plugins()`), JSDoc with the D5 security note.

##### Concurrency tests
(none — single-threaded builder)

##### Acceptance criteria
- `agent().settingSources(['project'])` type-checks and returns the builder; `.build()` output carries the value; `SettingSource` imported from the SDK (no local duplicate — G3).

##### DoD
- `pnpm --filter @theokit/agents test` green for the new test; `tsc` + eslint clean; file < 500 LoC.

#### Task T1.2 — Compile `settingSources` into `CompiledAgentOptions`

**Why this step.** *Action:* add `settingSources?: SettingSource[]` to `CompiledAgentOptions` and copy it in the compiler. *Reasoning:* the adapter reads `CompiledAgentOptions`; the value must survive compile (D1).

##### Files to edit
- `packages/agents/src/bridge/agent-compiler.ts` — add the field + copy from builder/decorator metadata.

##### TDD
- RED: `test_compile_carries_settingSources` — `compileAgentDefinition(agent().settingSources(['project','user']).build())` ⇒ `compiled.settingSources === ['project','user']`.
- GREEN: copy the field through `compileAgentDefinition`.
- REFACTOR: none beyond additive field.

##### Acceptance criteria
- Compiled output carries the array verbatim; absent when unset (no `[]` default that would change behavior).

##### DoD
- Compiler unit test green; `tsc` + eslint clean.

### Phase 2 — Project into `Agent.create({ local })` with cwd merge (the core fix)

#### Task T2.1 — Merge `settingSources` + `cwd` into `options.local`, decoupled from skills

**Why this step.** *Action:* rewrite the `sdk-adapter-create-options.ts:43` injection to spread-merge `settingSources` (from `compiled.settingSources`, else the skills-gated `['project']` default) and `cwd` into `options.local` without overwrite. *Reasoning:* D2 (merge, never overwrite; app-root cwd) + D3 (decouple from skills). This is the load-bearing change.

##### Files to edit
- `packages/agents/src/bridge/sdk-adapter-create-options.ts` — replace the `if (compiled.skills) { options.local = { settingSources: ['project'] } }` literal with a merge helper: `resolveLocalOptions(compiled)` returning `{ settingSources?, cwd? }`, applied additively.

##### Deep file dependency analysis
`assembleM8CreateOptions` is called only by `sdk-adapter.ts`; `sdk-adapter.ts:656` later does `m8.local = { ...m8.local, cwd: overrides.cwd }` — so the merge must be compatible with that downstream spread (no field clobbered). The `mcpServers` (#89) + `skills` + `context` branches stay.

##### TDD
- RED: `test_setting_sources_flows_to_agent_create_with_cwd` — compiled agent with `settingSources:['project']` (and NO inline skills) ⇒ `assembleM8CreateOptions(compiled).options.local` deep-equals `{ settingSources: ['project'] }` and, after the cwd override path, contains the passed `cwd` (not dropped). Also: `test_skills_only_still_gets_project_settingSources` (back-compat) and `test_no_settingSources_no_skills_leaves_local_absent`.
- RED (EC-3): `test_empty_settingSources_is_treated_as_unset` — `settingSources:[]` compiled ⇒ `local.settingSources` ABSENT (empty ⇒ same as unset; never inject `{ settingSources: [] }`), skills-gated default preserved.
- RED (EC-5): `test_settingSources_wins_over_skills_default_no_double_inject` — agent with BOTH `.settingSources(['project','user'])` and inline `.skills([...])` ⇒ `local.settingSources === ['project','user']` (explicit wins; the `['project']` skills default is NOT additionally merged/duplicated).
- RED (EC-4): `test_malformed_theokit_file_surfaces_configuration_error` (integration, T4.1 scope) — a malformed `SKILL.md` under the cwd with `settingSources:['project']` ⇒ the SDK's typed `ConfigurationError` PROPAGATES through the mountAgent request path (not swallowed), asserting the specific error type + message, and does NOT hard-crash the dev server.
- GREEN: implement `resolveLocalOptions` (empty-array → absent; explicit wins; spread-merge cwd).
- REFACTOR: extract the merge to keep `assembleM8CreateOptions` under the 50-LoC function budget (G6).

##### Failure scenarios
- `.theokit/` absent ⇒ `local.settingSources:['project']` with no files ⇒ SDK returns no discovered config, no throw (asserted in T4.1 integration).

##### Concurrency tests
(none — single-threaded projection)

##### Acceptance criteria
- With `compiled.settingSources` set and no skills, `local.settingSources` is present; cwd merges (never overwritten); skills-only agents byte-unchanged (`['project']` default preserved); no-config agents get no `local`.

##### DoD
- `packages/agents/tests/integration/m8-adapter-wiring.test.ts` extended + green; existing assertions still pass; `tsc`+eslint clean; function ≤ 50 LoC.

#### Task T2.2 — Thread the framework-resolved `projectRoot` into `local.cwd` at the create boundary (EC-1)

**Why this step.** *Action:* thread the vite plugin's already-resolved `projectRoot` (`agents-typed-client.ts:53`) through `mountAgent` (`agent-middleware.ts:233` — currently `mountAgent(mod, request, apiKey, agent.filePath, csrfMode)`) so the agent-create boundary defaults `local.cwd` to the **app/config root**, not blind `process.cwd()`. *Reasoning:* D2 + EC-1 — `process.cwd()` is not guaranteed to be the app root, and a wrong cwd makes `.theokit/` discovery silently find nothing.

##### Files to edit
- `packages/theo/src/server/agent/mount-agent.ts` — add a `projectRoot` parameter; when `settingSources` is active and no per-run cwd is present, pass `cwd: projectRoot` as the run override into the existing agent-create path.
- `packages/theo/src/vite-plugin/agent-middleware.ts` — pass the plugin's resolved `projectRoot` into the `mountAgent(...)` call (dev path).
- `packages/theo/src/cli/commands/start/handlers.ts` — pass the resolved root into `mountAgent` (prod `theokit start` path).

##### Deep file dependency analysis
`sdk-adapter.ts:656` ALREADY merges `overrides.cwd` into `m8.local` (`m8.local = { ...m8.local, cwd: overrides.cwd }`) — so setting the cwd override upstream in `mount-agent.ts` needs **no change to `sdk-adapter.ts`** (which is 695 LoC, already over the 500 budget — do NOT grow it; this is why the default lives in `mount-agent.ts`). The default applies ONLY when `settingSources` is active AND no explicit cwd — never override an explicit per-run cwd (Axis-A merge order). `mountAgent` has two callers (dev `agent-middleware.ts`, prod `start/handlers.ts`); both must pass the root (both already know it — dev via `opts.projectRoot`, prod via the resolved config).

##### TDD
- RED: `test_settingSources_cwd_is_config_root_not_process_cwd` — a compiled agent with `settingSources` and no cwd override, created via the boundary with a `projectRoot` argument ⇒ `local.cwd === projectRoot` (NOT `process.cwd()`). Assert with a projectRoot ≠ process.cwd() to prove the distinction.
- GREEN: thread `projectRoot` → default cwd.
- REFACTOR: keep the default computation isolated + commented (why config root, not process.cwd — cite EC-1).

##### Acceptance criteria
- `local.cwd` is the framework-resolved `projectRoot` when `settingSources` active + no override; an explicit per-run cwd override still wins; `process.cwd()` only as last-resort fallback when no root is threaded.

##### DoD
- Integration test green (projectRoot ≠ process.cwd() proves the fix); `tsc`+eslint clean; `mountAgent` signature change reflected in both callers.

### Phase 3 — Showcase dogfood: real `.theokit/` config + browser proof

#### Task T3.1 — Create `apps/showcase/.theokit/` config + opt in on the agent

**Why this step.** *Action:* add real `.theokit/skills/<n>/SKILL.md`, `.theokit/agents/<n>.md` (subagent), `.theokit/hooks.json`, `.theokit/mcp.json`, `.theokit/context/<n>.md`, `.theokit/cron/jobs.json`, and call `.settingSources(['project'])` on `apps/showcase/agents/chat.ts`. *Reasoning:* the Goal's observable outcome — prove discovery end-to-end.

##### Files to edit
- `apps/showcase/.theokit/skills/release-notes/SKILL.md` (NEW), `apps/showcase/.theokit/agents/code-reviewer.md` (NEW), `apps/showcase/.theokit/hooks.json` (NEW), `apps/showcase/.theokit/mcp.json` (NEW), `apps/showcase/.theokit/context/project.md` (NEW), `apps/showcase/.theokit/cron/jobs.json` (NEW), `apps/showcase/agents/chat.ts` (add `.settingSources(['project'])`).

##### Safe-by-construction (EC-2)
The proof rides on the **read-only** file types (skill, subagent, context) — these have no external process and cannot break agent-create. The subprocess-spawning types are made safe: `hooks.json` runs a trivial in-repo always-exit-0 command (e.g. `node .theokit/hooks/log.js` committed alongside, or `node -e "process.exit(0)"`) — never a missing script; `mcp.json` is included as a **documented discoverable example** but the demo does NOT depend on a live MCP subprocess for its pass condition (if the server can't start offline, the read-only-types proof still holds). `cron/jobs.json` is a benign long-interval log job, present as a discoverable-config example (EC-7).

##### TDD
- RED (harness, since showcase is not in the unit runner): a scaffold-style assertion is not applicable; instead the DoD is the **real-browser dogfood** — after `theokit dev`, sending a message that references the file-based `release-notes` skill causes the model to see it (evidence: the agent's system prompt lists the skill / a run reads it). Captured as dogfood evidence, not a vitest case.
- GREEN: create the files with valid frontmatter (SDK raises `ConfigurationError` on malformed — so files must parse); hooks/mcp safe per EC-2.
- REFACTOR: keep each file minimal + commented as an example; add the DEEP DIVE security note that project hooks execute shell (EC-6/D5).

##### Acceptance criteria
- `theokit dev` starts with no `ConfigurationError`; the agent run reflects the discovered skill/context; zero console errors in the browser; the pass condition depends on read-only-type discovery, NOT on a live MCP subprocess (EC-2).

##### DoD
- Real-browser dogfood: chat renders, a message that should trigger the file-based `release-notes` skill shows the model was aware of it (or `agent.skills.list()` includes it via a debug surface); screenshot + evidence recorded under `knowledge-base/dogfood/evidence/`.

### Phase 4 — Integration Validation (eat our own cooking)

#### Task T4.1 — Full chain green + real-browser end-to-end

**Why this step.** *Action:* run the whole gate + the browser dogfood. *Reasoning:* Quality Rule 18 — the plan is not done until the chain passes.

##### Files to edit
- (none new) — CHANGELOG `[Unreleased]` + a changeset (minor: `@theokit/agents` new method; patch: showcase is not published).

##### Acceptance criteria
- `pnpm --filter @theokit/agents test` green; root `pnpm test` green; `tsc` + eslint clean; G2 grep guard zero; changeset + CHANGELOG present; real-browser dogfood evidence recorded.

##### DoD
- All gates green; `knowledge-base/dogfood/evidence/` has a `theokit-file-based-config` entry with `outcome: pass`.

## Dependency Graph

- Phase 1 (T1.1 → T1.2) blocks Phase 2.
- Phase 2 (T2.1 → T2.2) blocks Phase 3 (the showcase needs the wired framework — but via workspace/overlay).
- Phase 3 blocks Phase 4.
- T1.1 and T1.2 are sequential (compile reads the builder field). T2.1/T2.2 sequential (cwd default builds on the merge).

## Coverage Matrix

| # | Requirement / gap | Task(s) | Test / evidence |
|---|---|---|---|
| G1 | `.settingSources()` builder method | T1.1 | `test_builder_settingSources_carries_to_config` |
| G2 | Compile the value into `CompiledAgentOptions` | T1.2 | `test_compile_carries_settingSources` |
| G3 | Merge into `local`, decouple from skills, never overwrite cwd | T2.1 | `test_setting_sources_flows_to_agent_create_with_cwd` |
| G4 | App-root cwd default | T2.2 | `test_settingSources_cwd_is_config_root_not_process_cwd` |
| G5 | Showcase `.theokit/` config (6 types) + opt-in | T3.1 | real-browser dogfood |
| G6 | Back-compat (skills-only unchanged) | T2.1 | `test_skills_only_still_gets_project_settingSources` |
| G7 | Hooks-shell security posture | T3.1 | D5 + hooks.json example + docs note |
| G8 | SDK owns discovery (no reimpl) | T4.1 | D4 — G2 grep guard zero |
| G9 | End-to-end browser proof | T4.1 | T3.1 dogfood evidence |
| G10 | EC-1 cwd = resolved projectRoot, not process.cwd() | T2.2 | `test_settingSources_cwd_is_config_root_not_process_cwd` |
| G11 | EC-2 safe showcase mcp/hooks; proof rides on read-only types | T3.1 | Safe-by-construction section |
| G12 | EC-3 empty `settingSources:[]` = unset | T2.1 | `test_empty_settingSources_is_treated_as_unset` |
| G13 | EC-4 malformed file → typed ConfigurationError propagates | T4.1 | `test_malformed_theokit_file_surfaces_configuration_error` |
| G14 | EC-5 settingSources wins over skills default | T2.1 | `test_settingSources_wins_over_skills_default_no_double_inject` |

## Global Definition of Done

- [ ] `pnpm --filter @theokit/agents test` + root `pnpm test` green.
- [ ] `tsc --noEmit` (agents + agents test config + theo) clean; `eslint packages/ --max-warnings=0` clean on touched files.
- [ ] G2 grep guard (`openrouter.ai|api.openai.com|api.anthropic.com` in `packages/`) returns zero (no runtime reimplementation).
- [ ] File-size budgets: every touched file < 500 LoC; `assembleM8CreateOptions` + new helpers ≤ 50 LoC each.
- [ ] CHANGELOG `[Unreleased]` entry + changeset (`@theokit/agents` minor).
- [ ] Real-browser dogfood evidence recorded (`knowledge-base/dogfood/evidence/theokit-file-based-config-*.md`, outcome pass).
