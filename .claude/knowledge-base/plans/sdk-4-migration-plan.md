---
slug: sdk-4-migration
created_at: 2026-07-15
goal: Migrate theokit to @theokit/sdk@4.0.1 by removing the pluggable conversation-storage subsystem
---

# Plan: Migrate theokit to `@theokit/sdk@4.0.1` (remove pluggable conversation-storage)

> **Version 1.1** (edge-cases EC-1..EC-6 absorbed 2026-07-15) — SDK 4.0.0 (SE40) deleted the entire pluggable conversation-storage contract (`ConversationStorageAdapter`, `InMemoryConversationStorage`, `FileSystemConversationStorage`, `AgentOptions.conversationStorage`) and replaced it with an automatic native Claude-shaped `.jsonl` transcript written to `<local.baseDir>/projects/<encoded-cwd>/<agentId>.jsonl`. theokit consumes that removed contract across 9 production files + the scaffold + ~20 tests, with one hard runtime break in `sdk-adapter.ts`. This plan bumps the SDK to `^4.0.1` and **removes the storage subsystem outright — no backward-compat shim, no deprecated no-ops** (explicit user directive, 2026-07-15). It threads the app's `projectRoot` as `local.baseDir` so sessions persist per-app. Outcome: theokit runs on SDK 4.0.1 with persistence intact via the native transcript. This is a **theokit MAJOR** (it removes the public `.conversationStorage()` builder method).

## Goal

> "Enable the `theokit` framework to run on `@theokit/sdk@4.0.1` by removing the pluggable conversation-storage subsystem and wiring the native transcript, measured by `pnpm --filter @theokit/agents test` returning green (719+ tests) AND a real-browser dogfood where an agent's todolist persists across two turns."

## Context

The team filed and closed 6 SDK issues in SE38 (`@theokit/sdk@3.7.0`), then SE40 shipped SDK 4.0.0 — a MAJOR that **removes the pluggable conversation-storage contract** and makes persistence an automatic native Claude-shaped `.jsonl` transcript (`local.baseDir` default `~/.theokit`). `@theokit/sdk@4.0.1` is live on npm (verified 2026-07-15; npm `latest` was 3.8.0, then 4.0.1 published). theokit is currently on `>=3.7.0` and consumes the removed surface heavily.

The M48 milestone (`ecosystem-integration-guarantee`) anticipated exactly this: the SDK↔theokit seam had no drift guard, and a major SDK bump is the first real test. The prior SDK-3 adoption (`[[project_theokit_adopt_sdk3]]`) taught that "`tsc` is necessary but not sufficient" — a major bump cascades into consumer code, test mocks, transitive deps, and stale guard tests.

**Decision locked by the user (2026-07-15):** no backward-compat. Remove all legacy storage code; do not keep `.conversationStorage()` as a no-op. This makes the migration mechanical rather than an API-rethink.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/sdk-adapter.ts` | 695 | `f8b90397` (2026-07-14) | The SDK runtime bridge: `loadSdkRuntime()` dynamic-imports the SDK; `newConversationStorage()` picks a store; `Agent.getOrCreate(sessionId, { conversationStorage })` runs the agent | Must keep `createSdkAgentStream` streaming events; the `ctx.threadId` session isolation (#119) and the M7 run-context wrapping stay intact; file must stay ≤ 500 LoC after edits (currently over budget — see D6) |
| `packages/agents/src/bridge/agent-builder.ts` | 204 | `f8b90397` (2026-07-14) | The fluent `agent()` builder; exposes `.conversationStorage(adapter)` (lines 138-140) | `.settingSources()`, `.tool()`, `.skills()`, type-state generics MUST keep working |
| `packages/agents/src/bridge/define-agent.ts` | 240 | `f8b90397` (2026-07-14) | `defineAgent()` + `DefineAgentConfig` (carries `conversationStorage?` at line 85) → `AgentDefinition` | The branded `AgentDefinition` shape stays; only the storage field is removed |
| `packages/agents/src/bridge/agent-compiler.ts` | 256 | `f8b90397` (2026-07-14) | Compiles `AgentDefinition` → `CompiledAgentOptions` (spreads `conversationStorage` at 148-154) | `compileAgentModule` output stays valid for `mount-agent` |
| `packages/agents/src/bridge/agent-endpoint.ts` | 253 | `f8b90397` (2026-07-14) | `streamAgentUIMessages` + `StreamAgentOptions` (carries `conversationStorage` at 164/193) | The UIMessageStream wire output is byte-stable |
| `packages/agents/src/bridge/agent-orchestrator.ts` | 191 | `f8b90397` (2026-07-14) | Multi-agent delegation; `DelegateOptions.conversationStorage` (67/162) | Delegation still forwards run-config minus storage |
| `packages/agents/src/loop/agent-runner.ts` | 350 | `f8b90397` (2026-07-14) | The reflective loop runner; `AgentRunnerRunOptions.conversationStorage` (128-132/269) | The reflective loop `run.stream()` wrapping stays intact |
| `packages/agents/src/decorators/conversation.ts` | 54 | `f8b90397` (2026-07-14) | An unused `@Conversation` decorator (0 production callers; 1 test fixture) | None — dead code, deleted in this plan (D4) |
| `packages/theo/src/cli/commands/generate.ts` | 507 | `f8b90397` (2026-07-14) | The `theo generate` scaffold; `generateMemoryTemplate` (259-282) emits `new InMemoryConversationStorage()` | The other generators (workflow/eval/etc.) MUST keep emitting; file ≤ 500 LoC target (currently over — extraction opportunity) |
| `packages/agents/package.json` | 63 | `f8b90397` (2026-07-14) | agents peer/dev deps (`@theokit/sdk >=3.7.0`) | — |
| `packages/theo/package.json` | 184 | (current) | theo peer/dev deps (`@theokit/sdk >=3.7.0`) | — |
| `packages/agents/tests/integration/conversation-storage.test.ts` | — | `f8b90397` | Tests the REMOVED pluggable-storage feature end-to-end | Deleted (D3) — the feature no longer exists |
| `CHANGELOG.md` | (current) | — | Keep-a-Changelog record | New `[Unreleased]` entries |

Every file in any task's `#### Files to edit` appears above. The ~19 other agents test files that mock storage are edited in Phase 5 (listed there, all under `packages/agents/tests/`).

### Current callers / dependents

- **Symbol:** `ConversationStorageAdapter` (SDK type, re-imported)
  - **Callers (production):** `sdk-adapter.ts:12`, `agent-builder.ts:18`, `define-agent.ts:14`, `agent-compiler.ts:11`, `agent-orchestrator.ts:14`, `agent-runner.ts:17`, `theo/src/server/agent/thread-dispatcher.ts` (type only)
  - **External (public API consumed by other repos):** YES — via the `.conversationStorage()` builder method + `defineAgent({conversationStorage})`. Consumers: the showcase (does NOT use it — uses `.settingSources` only) + the scaffold-generated `memory/*.ts`. Removing it is a **breaking change** → theokit MAJOR.
- **Symbol:** `InMemoryConversationStorage` / `FileSystemConversationStorage` (SDK runtime classes)
  - **Callers (production):** `sdk-adapter.ts:202,212-214,545,581-585`, `define-agent.ts`, `agent-runner.ts`, `generate.ts:262`
  - **The one hard runtime break:** `sdk-adapter.ts:202` `const InMemory = sdk.InMemoryConversationStorage` → `undefined` on 4.0.1 → `newConversationStorage()` at `581-585` throws `TypeError: InMemory is not a constructor`.
- **Symbol:** `.conversationStorage()` builder method — `agent-builder.ts:138-140` (interface) + `188-189` (runtime). No production caller in-repo besides tests; scaffold documents it.

### Domain glossary

- **Conversation storage (pluggable, REMOVED)** — the pre-4.0 SDK contract letting an app swap where turns persist (`InMemory` ⇄ `FileSystem` ⇄ custom adapter) via `Agent.create({ conversationStorage })`.
- **Native transcript (SE40, 4.0)** — the SDK now ALWAYS writes a Claude-shaped `.jsonl` DAG to `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl`; no opt-in, no adapter.
- **`local.baseDir`** — new `Agent.create` option; root of the native transcript tree; default `~/.theokit`; `~` expanded; set `~/.claude` for Claude-Code `--continue` interop.
- **`sessionId` / `threadId`** — the `Agent.getOrCreate(sessionId)` key; also the `<agentId>` in the transcript path and the `ctx.threadId` a stateful tool (`todolist`) keys on (#119).
- **`newConversationStorage()`** — theokit's own helper (`sdk-adapter.ts`) that instantiated a store; **deleted** by this plan.

### Architecture boundaries affected

- **`sdk-runtime.md` / G2 / ADR-0040:** "conversation **storage engine** stays SDK-owned." Removing theokit's pluggable-storage pass-through *strengthens* this invariant — theokit stops mediating a storage contract that is now the SDK's alone. No boundary is crossed the wrong way; a leak (theokit re-exposing SDK storage classes via the scaffold) is closed.
- **G1 dependency direction:** unchanged — agents→sdk (types + dynamic runtime), theo→agents.
- **G8 Web Standards:** unaffected.

## Prior Art & Related Work

- **Internal — M48 milestone** (`ROADMAP.md § M48 ecosystem-integration-guarantee`, added 2026-07-14): named this exact scenario (SDK major bump → local `CustomTool` mirror + consumed surface drift). This migration is the first exercise of that guarantee; the type-assignability gate M48 proposes would have flagged the `ConversationStorageAdapter` removal at compile time.
- **Internal — SDK-3 adoption memory** (`[[project_theokit_adopt_sdk3]]`): the SE36 `X.create` migration cascade — "tsc necessary not sufficient", 16 test mocks, transitive `@theokit/sdk-tools`, stale major-guard tests. Directly informs Phase 5 (test rewrite) sizing and the Global DoD's "run the FULL suite, not just typecheck" gate.
- **Internal — file-based-config EC-1** (`mount-agent.ts` `resolveDiscoveryCwd`, shipped 2026-07-14): the pattern of threading the framework-resolved `projectRoot` into the SDK's `local.*` options. D2 reuses it for `local.baseDir`.
- **External — SDK 4.0.0 CHANGELOG** (`theokit-sdk/packages/sdk/CHANGELOG.md § 4.0.0`): the authoritative list of removals + the `LocalOptions.baseDir` addition (`theokit-sdk/packages/sdk/src/types/agent.ts:44`). Cited as the migration's source of truth.
- **Patterns skills:** none match "sdk migration / conversation storage" (scanned `skills/*-patterns/` — none present). "(no domain patterns skill applies)".

## Dependencies

The plan adds NO new third-party dependency. It **bumps one existing first-party peer** and **removes** transitive usage. Per Unbreakable Rule 9 (don't reinvent) persistence is delegated wholly to the SDK — theokit deletes its storage code rather than re-implement the transcript.

| Ecosystem | Package | Version (from → to) | New? | Rule-9 (reuse vs reinvent) | CVE surface |
|---|---|---|---|---|---|
| npm | `@theokit/sdk` | `>=3.7.0` → `^4.0.1` | No (existing peer) | Reuse — the native transcript IS the storage engine; theokit removes its own | First-party (usetheodev), not on public CVE registries; scanned in T0.1 |
| npm | `@theokit/sdk-tools` | `^0.11.0` (unchanged) | No | Reuse (`todolist`) | First-party |

No `dependencies` block grows; the touched files NET-REMOVE imports. A version bump of an already-present package introduces no new attack surface.

## Objective

- [ ] Bump `@theokit/sdk` to `^4.0.1` in `packages/agents` + `packages/theo` (+ showcase) and install clean.
- [ ] Fix the hard runtime break in `sdk-adapter.ts` (remove storage-class destructure + `newConversationStorage` + the `conversationStorage` arg to `Agent.getOrCreate`) and wire `local.baseDir`.
- [ ] Remove `conversationStorage` from theokit's public surface (`.conversationStorage()` builder, `defineAgent({conversationStorage})`, and the compiled/endpoint/orchestrator/runner option types).
- [ ] Delete the dead `@Conversation` decorator + its barrel export + its lone test fixture.
- [ ] Rewrite the scaffold `generateMemoryTemplate` to reflect automatic native persistence (no `InMemory`/`FileSystem`).
- [ ] Rewrite/delete the ~20 agents tests that mock the removed storage surface; suite green.
- [ ] Real-browser dogfood: an agent's `todolist` persists across two turns via the native transcript.

## ADRs

### D1 — Remove the pluggable conversation-storage subsystem entirely (no shim, no deprecated no-op).
- **Decision:** Delete every reference to `ConversationStorageAdapter`, `InMemory/FileSystemConversationStorage`, `newConversationStorage`, and the `conversationStorage` field/option/builder-method. Do not keep a deprecated pass-through.
- **Rationale:** The SDK removed the underlying contract — a shim would have nothing to delegate to (G10: a no-op that "doesn't actually enforce behavior" is the most dangerous tech debt). The user explicitly directed "no retro-compat, remove legacy." Aligns with `sdk-runtime.md`/ADR-0040 ("storage engine is SDK-owned").
- **Alternatives considered:** (a) Keep `.conversationStorage()` as a no-op that warns — REJECTED: silent behavior loss, violates G10 honest enforcement, and the user forbade legacy. (b) Vendor a theokit-side storage adapter that writes the native transcript shape — REJECTED: reimplements the SDK storage engine (G2 BLOCKER).
- **Consequences:** Enables a clean 4.0.1 adoption; constrains theokit users who used `.conversationStorage(custom)` — they lose it (breaking → theokit MAJOR, documented in CHANGELOG § Removed).

### D2 — `local.baseDir` = the framework-resolved app root (reuse the EC-1 `projectRoot` threading).
- **Decision:** In `mount-agent` / the adapter, set `local.baseDir = projectRoot` when known (the same `projectRoot` already threaded for `.theokit/` discovery), falling back to the SDK default (`~/.theokit`) when unset.
- **Rationale:** A deployed web server's `~` may be ephemeral/read-only; per-app `<projectRoot>` co-locates the transcript with the app's own `.theokit/` config dir (predictable, deploy-safe). Reuses the shipped `resolveDiscoveryCwd` pattern (EC-1) — no new mechanism.
- **Alternatives considered:** (a) Leave `baseDir` unset (SDK default `~/.theokit`) — REJECTED: non-deterministic per host, unsafe on read-only home in prod. (b) Hardcode `./.data` — REJECTED: diverges from the `.theokit/` convention the app already uses.
- **Consequences:** Sessions live under `<projectRoot>/.theokit/projects/<encoded-cwd>/<agentId>.jsonl`; enables Claude-Code interop by letting an app override to `~/.claude`. Constrains: `projectRoot` must be resolvable at mount (it is — EC-1 already threads it).

### D3 — Delete `conversation-storage.test.ts` outright; rewrite the rest to drop storage mocks.
- **Decision:** The integration test that exercises pluggable storage is deleted (the feature is gone). The other ~19 tests that only *mock* `InMemory`/`FileSystem` as scaffolding have those mocks removed; their real assertions stay.
- **Rationale:** Testing a removed feature is dead weight; keeping a mock of a removed class is a fabrication (`testing.md` § anti-patterns). Deleting the feature's test is the correct expression of the removal.
- **Alternatives considered:** Keep the test but `.skip` it — REJECTED: `testing.md` forbids permanently-skipped tests (invisible debt).
- **Consequences:** Test count drops by the storage-specific cases; the suite reflects reality.

### D4 — Delete the unused `@Conversation` decorator (`conversation.ts`) opportunistically.
- **Decision:** Remove `packages/agents/src/decorators/conversation.ts`, its `decorators/index.ts` export, and its lone test fixture usage.
- **Rationale:** 0 production callers; it is conceptually adjacent to the removed storage (readers will conflate them). Removing it now prevents a "why is there a `@Conversation` if storage is gone?" confusion (YAGNI / KISS). Note it is a DISTINCT concept from `ConversationStorageAdapter` — this is cleanup, not part of the SDK removal.
- **Alternatives considered:** Leave it — REJECTED: dead export is a `/code-quality` FAIL_HARD candidate and adds confusion next to the storage removal.
- **Consequences:** Smaller public decorator surface; one fewer dead export.

### D5 — Rewrite `generateMemoryTemplate` to document automatic persistence (no emitted storage classes).
- **Decision:** The scaffold no longer emits `new InMemoryConversationStorage()`. Either drop the `memory/` generator or emit a short doc file explaining sessions auto-persist to `<projectRoot>/.theokit/projects/...` with zero setup.
- **Rationale:** The generated code imported now-removed SDK classes — it would not compile. Automatic persistence means there is nothing to wire (KISS: the best scaffold is the one you delete).
- **Alternatives considered:** Emit a `local.baseDir` override snippet — REJECTED as default: most apps want the framework default; an override belongs in docs, not generated boilerplate. (Kept as an optional comment.)
- **Consequences:** `theo generate memory` becomes a no-op or a doc; simpler scaffold.

### D6 — Keep `sdk-adapter.ts` under the 500-LoC budget after edits (net removal helps).
- **Decision:** The storage removal deletes ~30-40 LoC from `sdk-adapter.ts` (695 → ~655). If still over 500 after edits, extract the create-options assembly into the existing `sdk-adapter-create-options.ts` sibling rather than growing the file.
- **Rationale:** `system-design-guardrails.md` G6 BLOCKs at 500 LoC; the file is already over budget (pre-existing debt). This migration must not make it worse; net removal is the direction. Full sub-500 refactor is out of scope unless the edits push it further over.
- **Alternatives considered:** Full split now — REJECTED: scope creep; the migration is not a refactor mandate. Documented as pre-existing debt.
- **Consequences:** No new budget violation introduced; the pre-existing overage is logged, not fixed here.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| **Breaking public API** — removing `.conversationStorage()` breaks any theokit app using it | High | It is a MAJOR by design (user-directed); CHANGELOG § Removed documents it + the migration note (persistence is now automatic). In-repo, only the scaffold + tests used it — no silent breakage. | maintainer |
| **`baseDir` write failure in prod** — the native transcript writes to disk; a read-only/full `<projectRoot>` throws at run time (new external I/O failure mode) | Medium | Failure-scenarios test (baseDir unwritable → typed error surfaced, not a silent swallow); D2 picks a writable app-local dir; document the `local.baseDir` override for constrained hosts | maintainer |
| **Test-rewrite cascade underestimated** — 20 test files touch storage; the SE36→3.x cascade showed hidden mock coupling | Medium | Phase 5 runs the FULL agents suite (not just typecheck) after each cluster; the SDK-3 memory is cited as the sizing anchor | maintainer |
| **`sdk-adapter.ts` over LoC budget** (pre-existing 695 > 500) | Low | D6 — net removal + extract-if-worse; do not grow it | maintainer |
| **Native transcript changes on-disk session semantics** — sessions now write `.jsonl` DAGs instead of the prior store; existing sessions from 3.x are not migrated | Low | Sessions are ephemeral chat state, not source-of-truth data; a fresh transcript on first 4.0 run is acceptable; note in CHANGELOG | maintainer |

## Unresolved Questions

- Q1 — **RESOLVED (EC-2):** `local.baseDir` = `<projectRoot>/.data/agent-sessions` (NOT `.theokit`), keeping the git-tracked config dir clean of volatile session data. Gitignored.
- Q2 — **ELEVATED to a MUST-FIX gate (EC-1) in T1.1 Task 0:** whether `Agent.getOrCreate(sessionId)` resumes purely by `sessionId` is verified against the REAL 4.0.1 SDK with a 2-turn test BEFORE the Goal metric is claimed. If an explicit resume is required, T1.1 wires it.
- Q3 — Multi-tenant: two users with the SAME `sessionId` (guessable) would now share a `.jsonl` transcript on disk. Is the existing sessionId-guessing caveat (thread stream keyed on guessable sessionId) worsened by on-disk persistence? → `/edge-case-plan`.
- Q4 — Does `encodeProjectDir` / `transcriptPath` (still exported from `@theokit/sdk/persistence`) need to be consumed by theokit for anything (e.g., surfacing the transcript path), or is it purely SDK-internal now? → Phase 1.

## Dependency Graph

```
Phase 0 (deps bump) ──▶ Phase 1 (sdk-adapter runtime fix + baseDir)
                              │
                              ├──▶ Phase 2 (public API removal) ──▶ Phase 5 (test rewrite)
                              │                                          ▲
                              ├──▶ Phase 3 (delete @Conversation) ───────┤
                              │                                          │
                              └──▶ Phase 4 (scaffold rewrite) ───────────┘
                                                                         │
                                                                         ▼
                                                            Phase 6 (Integration Validation)
```

Phase 1 is the unblocker (fixes the runtime break). Phases 2/3/4 can run in parallel after Phase 1 (they touch disjoint files). Phase 5 depends on 2/3/4 (tests follow the code they cover). Phase 6 is terminal.

---

## Phase 0: Adopt `@theokit/sdk@4.0.1`

**Objective:** Move the peer/dev ranges to `^4.0.1` and install, so the toolchain resolves the new SDK.

### T0.1 — Bump SDK dep ranges to `^4.0.1`

#### Objective
`packages/agents` + `packages/theo` (+ `apps/showcase`) declare `@theokit/sdk@^4.0.1`; `pnpm install` resolves it.

#### Why this step (action + reasoning)
1. **What:** Edit the `peerDependencies` + `devDependencies` `@theokit/sdk` ranges from `>=3.7.0`/`^3.7.0` to `^4.0.1`; `pnpm install`.
2. **Why now:** Nothing else can be validated against 4.0.1 until it is resolved. A MAJOR floor bump (`^4.0.1`) is the conscious version bump M48/D-version-gate mandates (no open `>=` that would silently accept a future 5.x). This is the first, isolatable step.

#### Evidence
- npm `@theokit/sdk@4.0.1` live (verified 2026-07-15). Current floors `>=3.7.0` (`packages/agents/package.json:35`, `packages/theo/package.json:134`).

#### Files to edit
```
packages/agents/package.json — @theokit/sdk peer >=3.7.0 → ^4.0.1; dev ^3.7.0 → ^4.0.1
packages/theo/package.json — @theokit/sdk peer >=3.7.0 → ^4.0.1; dev ^3.7.0 → ^4.0.1
apps/showcase/package.json — @theokit/sdk ^3.7.0 → ^4.0.1 (dogfood surface; untracked)
```

#### Deep file dependency analysis
- These are manifest edits; the resolved version flows to `sdk-adapter.ts`'s dynamic import at runtime and to `tsc` at build.

#### Tasks
1. Edit the three manifests.
2. `pnpm install`.
3. Verify resolved: `node -e "require('@theokit/sdk/package.json').version"` from `packages/agents` prints `4.0.1`.

#### TDD
```
RED:     (no unit test — a manifest/version step; the RED is the build/suite failing to compile against 4.0.1, exercised in Phase 1+)
GREEN:   install resolves 4.0.1
VERIFY:  cd packages/agents && node -e "console.log(require('@theokit/sdk/package.json').version)"  # 4.0.1
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] All three manifests declare `^4.0.1`.
- [ ] `packages/agents` + `packages/theo` resolve `@theokit/sdk@4.0.1`.

#### DoD
- [ ] `pnpm install` clean; resolved version 4.0.1.

---

## Phase 1: Fix the runtime break in `sdk-adapter.ts` + wire `local.baseDir`

**Objective:** Remove storage-class loading + `newConversationStorage` + the `conversationStorage` arg to `Agent.getOrCreate`, and set `local.baseDir` so persistence works via the native transcript.

### T1.1 — Rip the storage runtime out of `sdk-adapter.ts`; wire native transcript

#### Objective
`loadSdkRuntime()` no longer touches `InMemory/FileSystemConversationStorage`; `newConversationStorage` is deleted; `Agent.getOrCreate` is called WITHOUT `conversationStorage` and WITH `local.baseDir`.

#### Why this step (action + reasoning)
1. **What:** Delete the `SdkRuntime` storage fields + their destructure (`202`, `212-214`), delete `newConversationStorage()` (`229-235`) and the `storage` closure var (`520-521`, `581-585`), drop `conversationStorage: storage` from the `Agent.getOrCreate` call (`674`), and add `local.baseDir` (from the threaded `projectRoot`/overrides) to the create options.
2. **Why now:** This is the single hard runtime break (D1 evidence: `sdk-adapter.ts:202` → `undefined` → `TypeError` at `581-585`). Nothing runs until this is fixed; it is the graph's unblocker. Reuses the EC-1 `cwd` threading for `baseDir` (D2).

#### Evidence
- `sdk-adapter.ts:202` `const InMemory = sdk.InMemoryConversationStorage` (→ `undefined` on 4.0.1); `:581-585` `newConversationStorage` calls `new InMemory()`; `:674` `conversationStorage: storage`. SDK 4.0.1 `LocalOptions.baseDir` at `theokit-sdk/packages/sdk/src/types/agent.ts:44`.

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — remove storage load/create/arg; add local.baseDir
packages/agents/tests/integration/adapter-real-usage.test.ts — RED: assert getOrCreate called WITHOUT conversationStorage and WITH local.baseDir; no InMemory reference
```

#### Deep file dependency analysis
- `sdk-adapter.ts` today (Baseline row) builds a `storage` and passes it to `Agent.getOrCreate`. After: no storage; the SDK writes the transcript itself. Downstream `createSdkAgentStream` callers (`agent-endpoint.ts`, `agent-runner.ts`) stop forwarding storage (Phase 2).
- `loadSdkRuntime`'s `SdkRuntime` interface drops `InMemoryConversationStorage`/`FileSystemConversationStorage` fields.

#### Deep Dives
- **Invariant:** `ctx.threadId` session isolation (#119) + M7 run-context wrapping MUST survive — they are orthogonal to storage (they live in `withRunContext`/`buildSdkTools`). Verify the `sessionId` still keys `Agent.getOrCreate` (it does; only the storage arg is removed).
- **`baseDir` resolution:** `local.baseDir = overrides.baseDir ?? undefined`; the concrete `projectRoot → baseDir` threading is added in T1.2 (mount-agent) — this task accepts the override and defaults to SDK behavior when unset.
- **Edge case:** SDK predating 4.0 (a consumer on 3.x) — the dynamic import would lack `baseDir` support; but the peer floor is now `^4.0.1` (Phase 0), so this is contractually excluded. No `in`-guard needed (unlike the prior optional-symbol guards).

#### Pseudo-code / Signatures
```pseudocode
// loadSdkRuntime(): SdkRuntime  — storage fields GONE
return { Agent, defineTool: sdk.Tool.create.bind(sdk.Tool),
         ...(skillReadTool ? { defineSkillReadTool } : {}) }

// streamSdkAgent create options:
const agent = await Agent.getOrCreate(sessionId, {
  apiKey, model, tools: sdkTools, ...m8, ...extra,
  local: { ...m8.local, ...(overrides.baseDir ? { baseDir: overrides.baseDir } : {}) },
  // conversationStorage: REMOVED
})
```

#### Tasks
0. **(EC-1 pre-condition gate — MUST run first)** Verify resume-by-`sessionId` on the REAL SDK 4.0.1: grep `getOrCreate`/`run.conversation` in the installed `@theokit/sdk` `.d.ts`; write an integration test that runs two turns on the SAME `sessionId` against the real SDK and asserts turn-2 sees turn-1's history from the native transcript. If 4.0.1 needs an explicit resume call, add it here. **Do NOT proceed to Phase 6 until this is green** — the Goal's persistence metric rests on it (resolves Unresolved Q2).
1. Delete storage fields from `SdkRuntime` + the `202/212-214` destructure.
2. Delete `newConversationStorage()` + the `storage` closure var + its `??=` init.
3. Drop `conversationStorage: storage` from `getOrCreate`; add `local.baseDir` from `overrides.baseDir`.
4. Add `baseDir?: string` to `RuntimeOverrides`.

#### TDD
```
RED:     test_resume_by_sessionId_native_transcript() — (EC-1) two turns, same sessionId, against the REAL SDK: turn-2 sees turn-1 history. MUST fail if resume is not wired.
RED:     test_getOrCreate_called_without_conversationStorage() — asserts the create options object has NO `conversationStorage` key
RED:     test_getOrCreate_forwards_baseDir_override() — passing overrides.baseDir sets local.baseDir
RED:     test_loadSdkRuntime_has_no_storage_fields() — the runtime object lacks InMemory/FileSystem fields
RED:     test_transcript_write_surfaces_typed_error_when_baseDir_unresolvable() — (EC-3) baseDir unwritable/unresolvable ⇒ stream yields {type:'error', code:'SDK_ERROR'}, never a silent empty stream or hang
GREEN:   Apply the removals + baseDir wiring (+ explicit resume if EC-1 requires it)
REFACTOR: If sdk-adapter.ts still > 500 LoC, extract create-options into sdk-adapter-create-options.ts (D6)
VERIFY:  pnpm --filter @theokit/agents test -- adapter-real-usage
```

#### Concurrency tests

(none — single-threaded)

The removed storage was I/O, but the SDK owns the transcript write now; theokit no longer touches it. Concurrent same-session appends are the SDK's responsibility (EC-5), not theokit's.

#### Acceptance Criteria
- [ ] No reference to `InMemoryConversationStorage`/`FileSystemConversationStorage`/`newConversationStorage`/`conversationStorage` remains in `sdk-adapter.ts`.
- [ ] `Agent.getOrCreate` options carry `local.baseDir` (when overridden) and NO `conversationStorage`.
- [ ] Pass: size — `sdk-adapter.ts` ≤ its current LoC (net removal); if still > 500, create-options extracted (D6).
- [ ] Pass: lint/typecheck on the file.

#### DoD
- [ ] `pnpm --filter @theokit/agents test -- adapter-real-usage` green.
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` clean.

### T1.2 — Thread `projectRoot` → `local.baseDir` in `mount-agent`

#### Objective
`mountAgent` passes the framework-resolved `projectRoot` as `overrides.baseDir` (reusing the EC-1 cwd path), so sessions persist under the app root.

#### Why this step (action + reasoning)
1. **What:** In `mount-agent.ts`, add `baseDir: resolveDiscoveryCwd(...)`-style resolution (or reuse `projectRoot`) to the `streamAgentUIMessages` overrides.
2. **Why now:** T1.1 accepts a `baseDir` override but does not source it; this sources it (D2). Without it, the SDK default `~/.theokit` applies (unsafe in prod per Drawbacks).

#### Evidence
- `mount-agent.ts` `resolveDiscoveryCwd(compiled, projectRoot)` (shipped 2026-07-14, file-based-config EC-1) already threads `projectRoot`.

#### Files to edit
```
packages/theo/src/server/agent/mount-agent.ts — add baseDir from projectRoot to the stream overrides
packages/theo/src/cli/commands/generate.ts (scaffold .gitignore) + apps/showcase/.gitignore — EC-2: ignore the transcript path
packages/agents/tests/integration/setting-sources-malformed-config.test.ts OR a new mount test — RED: baseDir threaded + discovery ignores projects/
```

#### Deep file dependency analysis
- `mount-agent.ts` already computes `cwd` from `projectRoot`; `baseDir` follows the same resolution. Downstream: `streamAgentUIMessages` → `createSdkAgentStream` (T1.1 override).
- **(EC-2)** The SDK writes `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl`. Two hazards resolved here: (a) these ephemeral session files must be **gitignored** (they hold conversation content); (b) the `settingSources(['project'])` discovery scans `.theokit/{skills,agents,hooks,mcp,context,cron}` — it MUST NOT mis-read a `projects/` subdir as config. Test proves the discovery ignores `projects/`. **Resolves Q1:** default `baseDir = <projectRoot>/.data/agent-sessions` (NOT `<projectRoot>/.theokit`), so the transcript never lands inside the git-tracked config dir — cleaner separation than co-locating under `.theokit/`.

#### Tasks
1. Resolve `baseDir` from `projectRoot` → `<projectRoot>/.data/agent-sessions` (Q1 resolved to `.data`, EC-2).
2. Pass it into `streamAgentUIMessages` overrides.
3. (EC-2) Add the transcript glob to the scaffold `.gitignore` template + `apps/showcase/.gitignore`.

#### TDD
```
RED:     test_mountAgent_threads_projectRoot_as_baseDir() — asserts the override carries baseDir under projectRoot
RED:     test_settingSources_discovery_ignores_projects_subdir() — (EC-2) a projects/ dir under the config root is NOT read as config
GREEN:   thread it + gitignore
VERIFY:  pnpm --filter @theokit/agents test (mount path)
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `baseDir` = `<projectRoot>/.data/agent-sessions` when known; unset (SDK default) otherwise.
- [ ] (EC-2) The transcript path is gitignored in the scaffold + showcase; discovery ignores `projects/`.

#### DoD
- [ ] Test green; typecheck clean.

---

## Phase 2: Remove `conversationStorage` from theokit's public surface

**Objective:** Delete the `.conversationStorage()` builder method, the `defineAgent({conversationStorage})` config field, and the compiled/endpoint/orchestrator/runner option types.

### T2.1 — Remove `.conversationStorage()` from the builder + `defineAgent` config

#### Objective
`agent().conversationStorage(...)` no longer exists (compile error for callers); `DefineAgentConfig`/`AgentDefinition` carry no storage field.

#### Why this step (action + reasoning)
1. **What:** Delete the `conversationStorage` interface method + runtime (`agent-builder.ts:138-140,188-189`), the `DefineAgentConfig.conversationStorage` field + spread (`define-agent.ts:80-85,192-194`), and the `ConversationStorageAdapter` type imports in both.
2. **Why now:** These are the user-facing entry points to the removed subsystem (D1). Removing them makes the breakage a clean compile error (honest) rather than a runtime surprise.

#### Evidence
- `agent-builder.ts:138-140` (interface), `188-189` (runtime); `define-agent.ts:85` (field), `192-194` (spread).

#### Files to edit
```
packages/agents/src/bridge/agent-builder.ts — remove .conversationStorage() + import
packages/agents/src/bridge/define-agent.ts — remove conversationStorage field + spread + import
tests/type/agent-builder.test-d.ts (or the existing type test) — RED: .conversationStorage no longer a method (@ts-expect-error)
```

#### Deep file dependency analysis
- `agent-builder.ts` type-state generics stay; only the one method is removed. `define-agent.ts` `AgentDefinition` loses the field; `agent-compiler.ts` (T2.2) stops reading it.

#### Tasks
1. Delete the builder method (interface + runtime).
2. Delete the `defineAgent` field + spread + imports.

#### TDD
```
RED:     test-d: `agent().conversationStorage` is `never`/absent (@ts-expect-error on a call)
RED:     test_defineAgent_ignores_conversationStorage() — passing it is a type error / dropped
GREEN:   remove the surfaces
REFACTOR: None expected
VERIFY:  npx tsc --noEmit -p packages/agents/tsconfig.test.json && pnpm --filter @theokit/agents test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `agent().conversationStorage` does not typecheck.
- [ ] No `ConversationStorageAdapter` import remains in either file.

#### DoD
- [ ] Typecheck + agents suite green.

### T2.2 — Remove `conversationStorage` from compiler/endpoint/orchestrator/runner option types

#### Objective
`CompiledAgentOptions`, `StreamAgentOptions`, `DelegateOptions`, `AgentRunnerRunOptions` carry no `conversationStorage`; nothing forwards it.

#### Why this step (action + reasoning)
1. **What:** Delete the `conversationStorage` field + forwarding + `ConversationStorageAdapter` import in `agent-compiler.ts` (148-154), `agent-endpoint.ts` (164,193), `agent-orchestrator.ts` (67,162), `agent-runner.ts` (128-132,269), and the type import in `theo/.../thread-dispatcher.ts`.
2. **Why now:** These plumb storage from the definition to the adapter; once T1.1 (adapter) + T2.1 (definition) drop it, these are dangling and would not compile.

#### Evidence
- Cited lines per Baseline Context row for each file.

#### Files to edit
```
packages/agents/src/bridge/agent-compiler.ts — remove field/spread/import
packages/agents/src/bridge/agent-endpoint.ts — remove field/assignment
packages/agents/src/bridge/agent-orchestrator.ts — remove field/forwarding/import
packages/agents/src/loop/agent-runner.ts — remove field/forwarding/import
packages/theo/src/server/agent/thread-dispatcher.ts — remove ConversationStorageAdapter type import/usage
packages/agents/tests/integration/{m8-adapter-wiring,delegate-per-run-config,loop-session-history}.test.ts — RED: no storage forwarding
```

#### Deep file dependency analysis
- Each option type drops one field; the forwarding chain (definition → compiled → endpoint/runner → adapter) loses its storage link end-to-end. `thread-dispatcher.ts` only used the type — import removed.

#### Tasks
1. Remove the field + forwarding in each of the 5 files.
2. Remove now-unused imports.

#### TDD
```
RED:     test_compiled_options_have_no_conversationStorage()
RED:     test_delegate_does_not_forward_storage()
GREEN:   remove the fields/forwarding
REFACTOR: None expected
VERIFY:  npx tsc --noEmit -p packages/agents/tsconfig.test.json && npx tsc --noEmit -p packages/theo/tsconfig.json && pnpm --filter @theokit/agents test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -rn "conversationStorage\|ConversationStorageAdapter" packages/*/src` returns ZERO (outside CHANGELOG).
- [ ] Both package typechecks clean.

#### DoD
- [ ] Zero grep hits; typecheck + suite green.

---

## Phase 3: Delete the dead `@Conversation` decorator

**Objective:** Remove `conversation.ts`, its barrel export, and its test fixture usage.

### T3.1 — Delete `@Conversation`

#### Objective
`packages/agents/src/decorators/conversation.ts` is gone; no export, no fixture references it.

#### Why this step (action + reasoning)
1. **What:** `rm` the file, remove its `decorators/index.ts` export, and update `artifact-checkpoint-observable.test.ts` (the lone fixture) to not use it.
2. **Why now:** 0 production callers (D4 evidence); leaving a `@Conversation` decorator next to a just-removed storage subsystem is actively confusing and is a `/code-quality` dead-export finding.

#### Evidence
- `decorators/conversation.ts` (54 LoC, 0 prod callers); `decorators/index.ts:28` export; 1 fixture in `artifact-checkpoint-observable.test.ts`.

#### Files to edit
```
packages/agents/src/decorators/conversation.ts — DELETE
packages/agents/src/decorators/index.ts — remove the export
packages/agents/tests/**/artifact-checkpoint-observable.test.ts — remove the @Conversation fixture usage
```

#### Deep file dependency analysis
- Dead export → deletion has no production impact; the fixture is updated to drop the decorator (it tests checkpoints, not conversation).

#### Tasks
1. Delete the file + export.
2. Update the fixture test.

#### TDD
```
RED:     test suite compiles without the @Conversation import (the fixture edit is the change; RED = current import fails after delete)
GREEN:   remove usages
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -rn "@Conversation\|conversation.js" packages/agents/src` returns ZERO.

#### DoD
- [ ] Suite green; no dead export.

---

## Phase 4: Rewrite the scaffold memory template

**Objective:** `theo generate` no longer emits code importing the removed SDK storage classes.

### T4.1 — Rewrite `generateMemoryTemplate`

#### Objective
The scaffold reflects automatic native persistence (no `InMemory`/`FileSystem`).

#### Why this step (action + reasoning)
1. **What:** Replace the `memory/*.ts` template (`generate.ts:259-282`) — either drop the `memory` generator or emit a short doc explaining sessions auto-persist under `<projectRoot>/.theokit/projects/...`.
2. **Why now:** The current template imports `InMemoryConversationStorage`/`FileSystemConversationStorage` — generated apps would not compile on 4.0.1. D5.

#### Evidence
- `generate.ts:259-282` emits `new InMemoryConversationStorage()` + `.conversationStorage(...)` docs.

#### Files to edit
```
packages/theo/src/cli/commands/generate.ts — rewrite/remove generateMemoryTemplate
packages/agents/tests/** or theo tests — RED: generated memory output has no InMemory/FileSystem import
```

#### Deep file dependency analysis
- Only the `memory` sub-generator changes; workflow/eval/etc. generators untouched. If `generate.ts` stays > 500 LoC, note the pre-existing overage (do not grow it).

#### Tasks
1. Rewrite the template to a doc (or remove the case).
2. Update the generator test.

#### TDD
```
RED:     test_generate_memory_emits_no_removed_storage() — output contains no InMemory/FileSystemConversationStorage
GREEN:   rewrite the template
VERIFY:  (theo generate test) pnpm test -- generate
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Generated `memory` output has no removed-symbol import.

#### DoD
- [ ] Generator test green.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Bump SDK to 4.0.1 (agents + theo + showcase) | T0.1 | `^4.0.1` floors + install |
| 2 | Fix the hard runtime break (`sdk-adapter.ts:202`) | T1.1 | Storage load/create/arg removed; `local.baseDir` wired |
| 3 | Persist per-app (not `~/.theokit`) | T1.2 | `projectRoot` → `local.baseDir` (EC-1 reuse) |
| 4 | Remove `.conversationStorage()` public builder + `defineAgent` field | T2.1 | Builder method + config field deleted |
| 5 | Remove `conversationStorage` from compiled/endpoint/orchestrator/runner types | T2.2 | Fields + forwarding + imports removed; grep-zero |
| 6 | Delete dead `@Conversation` decorator | T3.1 | File + export + fixture removed |
| 7 | Scaffold no longer emits removed storage classes | T4.1 | `generateMemoryTemplate` rewritten |
| 8 | ~20 tests mocking removed storage rewritten/deleted | T5.1 | `conversation-storage.test.ts` deleted; others drop storage mocks |
| 9 | Suite + typecheck + lint green against 4.0.1 | T6.1 | Full validation chain |
| 10 | Dogfood: todolist persists across 2 turns via native transcript | T6.1 | Real-browser proof |
| 11 | CHANGELOG § Removed documents the breaking removal | T6.1 | Rule 6 |

**Coverage: 11/11 gaps covered (100%)**

## Phase 5: Rewrite the storage-coupled tests

**Objective:** Delete `conversation-storage.test.ts`; strip storage mocks from the other ~19 agents tests; suite green.

### T5.1 — Delete the pluggable-storage test; strip storage mocks from the rest

#### Objective
No test references a removed symbol; every remaining test asserts real 4.0.1 behavior.

#### Why this step (action + reasoning)
1. **What:** Delete `packages/agents/tests/integration/conversation-storage.test.ts` (D3). In the other ~19 files (listed in the Baseline recon), remove `InMemory`/`FileSystem`/`conversationStorage` mock setup; keep the real assertions.
2. **Why now:** After Phases 1-4 the symbols are gone; these tests would not compile. The SDK-3 memory warns this cluster is the cascade's bulk — run the FULL suite after each cluster.

#### Evidence
- 20 files under `packages/agents/tests/` reference the removed symbols (recon PART A).

#### Files to edit
```
packages/agents/tests/integration/conversation-storage.test.ts — DELETE
packages/agents/tests/integration/{adapter-real-usage,agent-builder-runtime,loop-session-history,delegate-per-run-config,run-context,sdk-adapter-reasoning,setting-sources-malformed-config,runner-sdk-tools,skill-read-autowire,m8-adapter-wiring,sdk-adapter-tool-schema-routing,sdk-adapter-translation,sdk-adapter-recover-leaked,runtime-overrides,sdk-adapter-streaming,systemprompt-resolver-stream,sdk-adapter-tool-dialect}.test.ts — strip storage mocks
packages/agents/tests/unit/{agent-endpoint,ui-message-stream-translator}.test.ts — strip storage mocks
```

#### Deep file dependency analysis
- Most files only used the storage classes as inert mock scaffolding for `Agent.getOrCreate`; removing the mock + the arg leaves the real assertion intact. `loop-session-history.test.ts` may assert history persistence — re-point it to the native-transcript behavior (or a mocked `Agent` that records turns) rather than an `InMemory` adapter.

#### Tasks
1. Delete the storage feature test.
2. Cluster the remaining edits (adapter / loop / endpoint) and run the suite after each cluster.

#### TDD
```
RED:     the suite fails to compile against 4.0.1 with the old mocks (the starting state)
GREEN:   strip mocks; suite compiles + passes
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -rn "conversationStorage\|ConversationStorage" packages/agents/tests` returns ZERO.
- [ ] `pnpm --filter @theokit/agents test` green (≥ 700 tests; count drops by the deleted storage cases).

#### DoD
- [ ] Suite green; grep-zero in tests.

---

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — the FULL `pnpm --filter @theokit/agents test` suite is green AND `pnpm test` (root) green. (EC-6: the total count is REDUCED by the deleted storage cases — assert "all green", NOT a `≥ N` floor.)
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` + `npx tsc --noEmit -p packages/theo/tsconfig.json`.
- [ ] Zero lint warnings — `npx biome check packages/` (or the project's `pnpm lint`) on changed files.
- [ ] File-size budget respected — no changed file grows past 500 LoC; `sdk-adapter.ts` net-shrinks (D6); pre-existing overage logged.
- [ ] CHANGELOG.md updated under `[Unreleased] § Removed` (the `.conversationStorage()` API + pluggable storage) AND `§ Changed` (SDK `^4.0.1`) — Unbreakable Rule 6. The § Removed note MUST include: (EC-4) sessions now persist on disk so a guessable `sessionId` leak is durable — apps MUST gate `sessionId`; (EC-5) concurrent same-session appends are delegated to the SDK's transcript engine.
- [ ] **Backward compatibility INTENTIONALLY BROKEN** across public API (`.conversationStorage()` removed) — this is a theokit MAJOR by user directive; documented in CHANGELOG § Removed with the migration note (persistence is now automatic; no action needed for apps that did not call `.conversationStorage()`).
- [ ] `grep -rn "ConversationStorageAdapter\|InMemoryConversationStorage\|FileSystemConversationStorage\|newConversationStorage\|conversationStorage" packages/*/src` returns ZERO.
- [ ] **Runtime-metric proof** — the native transcript file is observed on disk at `<projectRoot>/.theokit/projects/<encoded-cwd>/<agentId>.jsonl` after an integration run (not just compiled).
- [ ] **Dogfood** — real-browser: an agent's `todolist` items added in turn 1 are returned by `list` in turn 2 (session persists via the native transcript + the shipped `chatId`→sessionId fix).
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/sdk-4-migration-plan.md`.

## Failure scenarios (external I/O)

The native transcript writes to the local filesystem (new external I/O the SDK performs on theokit's behalf; theokit chooses the `baseDir`).

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| Native transcript (filesystem write to `local.baseDir`) | `baseDir` not writable (read-only mount / no perms) | integration test points `local.baseDir` at a read-only dir | the SDK surfaces a typed error via the stream (`type:'error'`, `code:'SDK_ERROR'`); theokit does NOT swallow it (fail-loud per `error-handling.md`); the agent request returns an error event, not a silent empty stream |
| Native transcript (disk) | `baseDir` parent missing | point at a non-existent nested path | either the SDK creates it OR errors clearly; theokit surfaces whatever the SDK returns (no silent success) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate theokit runs on 4.0.1 in a real workload — agents suite + typecheck + lint + a real-browser dogfood proving persistence.

### T6.1 — Full validation chain + CHANGELOG + real-browser dogfood

#### Objective
The full agents + root suites are green against 4.0.1, the CHANGELOG documents the breaking removal (EC-4/EC-5 notes), and a real browser proves the todolist persists across two turns via the native transcript.

#### Why this step (action + reasoning)
1. **What:** Run the validation chain (§ Execution below); write the CHANGELOG `[Unreleased] § Removed` + `§ Changed`; overlay the local build into the showcase and dogfood a 2-turn todolist.
2. **Why now:** Terminal "eat your own cooking" gate — the plan is not done until the real workload passes (cites the Goal metric + the EC-1 resume gate + the EC-6 count note).

#### Files to edit
```
CHANGELOG.md — § Removed (.conversationStorage() + pluggable storage; EC-4/EC-5 notes) + § Changed (SDK ^4.0.1)
```

#### Tasks
1. Run the § Execution chain; fix any plan-caused failure.
2. Write the CHANGELOG entries (Rule 6).
3. Overlay + dogfood the 2-turn todolist in a real browser; confirm the `.jsonl` transcript on disk.

#### TDD
```
RED:     the suite/dogfood fails against 4.0.1 before Phases 1-5 land (the starting state)
GREEN:   all green + dogfood passes
VERIFY:  pnpm --filter @theokit/agents test && pnpm test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Full agents + root suites green; typecheck + lint clean.
- [ ] CHANGELOG § Removed + § Changed written with EC-4/EC-5 notes.
- [ ] Real-browser dogfood: turn-2 `list` returns turn-1 items; `.jsonl` transcript observed on disk.

### Execution
```
pnpm --filter @theokit/agents test          # ≥ 700 tests green against 4.0.1
pnpm test                                    # root suite green
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx tsc --noEmit -p packages/theo/tsconfig.json
npx biome check packages/                    # zero warnings on changed files
```

Dogfood (real browser, overlay the local build into the showcase):
```
1. Bump showcase @theokit/sdk → ^4.0.1; build agents + theo; overlay; restart dev.
2. Turn 1: agent adds two todolist items. Turn 2: `list` returns them.
3. Confirm the transcript .jsonl exists under <projectRoot>/.theokit/projects/...
```

### Acceptance Criteria
- [ ] agents + root suites green; zero type errors; zero lint warnings.
- [ ] Coverage ≥ 90% on changed files (critical paths 100%).
- [ ] Runtime-metric proof — the `.jsonl` transcript observed on disk after a run.
- [ ] Failure scenarios green — the unwritable-`baseDir` test surfaces a typed error (no silent swallow).
- [ ] Dogfood — todolist persists across two turns in a real browser.

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description (do not block on them).
