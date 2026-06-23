# ADR 0031 — M8 decorator runtime: wire the 3 mapped agents decorators; di/gateways/plugins stay imperative-first

**Status:** Accepted
**Date:** 2026-06-22
**Deciders:** project owner
**Milestone:** M8 (Camada declarativa — Tema F / Seção 6)
**Plan:** `.claude/knowledge-base/plans/m8-decorator-runtime-plan.md`

## Context

The gap audit's M8 targets the "decorator sem runtime" anti-pattern: three
`@theokit/agents` decorators (`@ContextWindow`/`@AutoSummarize`, `@ProjectContext`,
`@Skills`) stored configuration via `setMeta` but **nothing ever executed it** —
`getContextWindowConfig`/`getProjectContextConfig` had zero production callers, and
`getSkillsConfig` was walked but never reached `Agent.create()`. M8-4 asks the
strategic question: *what is the future of the broader declarative layer —
`@theokit/di`, gateways, `@theokit/orm`, `http-decorators`?*

The relevant prior decision is the SDK's **decorators-optional** rule
(`theokit-sdk/CLAUDE.md` §"Inviolable rules" rule 9, recorded 2026-06-18): it
**revoked** the earlier "decorators mandatory via `@theokit/di`" rule because that
forced the Harness to ship a generic IoC container and drove Backend-DX scope
creep (di → di-agent → orm → http-decorators), violating Rule 7 (don't reinvent),
KISS and YAGNI. The ecosystem direction is **imperative-first, local-first**:
factory functions are the canonical API; decorators are an optional convenience.

A second relevant invariant is ADR 0030 (this repo): library sub-packages must
never depend on the principal `theokit`. M8 adds only `@theokit/agents → @theokit/sdk`
and `@theokit/agents → @theokit/sdk-tools` edges — the correct direction.

## Decision

1. **Wire only the three `@theokit/agents` decorators that have a concrete SDK
   mapping.** `@Skills` → `AgentOptions.skills` (`SkillsSettings`); `@ContextWindow`
   → `AgentOptions.context` (`ContextSettings.maxTokens`); `@ProjectContext` → a
   `SystemPromptResolver` composing `buildEnvContext`/`buildRepoMap`/
   `readProjectInstructions`. The bridge **compiles**; the SDK **executes**
   (`sdk-runtime.md`). No new runtime is introduced in `@theokit/agents`.

2. **Decorator knobs with no native SDK mapping warn, never silently no-op.**
   `@ContextWindow.{compactionStrategy,preserveLastN,preserveToolResults,
   preserveSystemPrompt}` and `@ProjectContext.{indexStrategy,relevanceStrategy,
   maxFilesInContext,includeExtensions,rootMarkers}` emit a stable
   `THEO_AGENT_*_METADATA_ONLY` warning (G10 — honest enforcement), mirroring the
   existing interceptor/filter/budget metadata-only pattern.

3. **`@theokit/di` / gateways / `@theokit/orm` / `http-decorators` remain an
   OPTIONAL, imperative-first convenience layer.** M8 does **not** build a generic
   decorator→runtime compiler for that ecosystem, and does not introduce an IoC
   container into the Harness. Those packages keep evolving independently in their
   own repos, consumed only by apps that opt in.

## Rationale

- The SDK's decorators-optional decision (rule 9) already settled the strategic
  direction: imperative-first. Building decorator runtime for the whole di
  ecosystem would re-open the exact scope creep that decision rejected.
- The three agents decorators are cheap to wire because the SDK already exposes
  native fields for them — runtime is a shape translation, not a new subsystem.
- Honest warnings over silent no-ops keep the declarative surface trustworthy:
  a knob either does something or says it does not (G10, Unbreakable Rule 3).

## Alternatives considered

- **Build a generic decorator→runtime compiler for the whole di/gateways/plugins
  ecosystem.** REJECTED — YAGNI + re-opens the Backend-DX scope creep that the
  SDK decorators-optional decision (rule 9) explicitly rejected; no current
  consumer demand.
- **Deprecate `@ContextWindow`/`@ProjectContext`/`@Skills` outright** (delete the
  metadata-only decorators instead of giving them runtime). REJECTED — they map
  cleanly to native SDK fields, so runtime is cheap and delivers real value; the
  declarative layer is a legitimate optional convenience.
- **Drive `compactTranscript`/`shouldCompact` in a bridge-owned transcript loop
  to honor `@ContextWindow`'s strategy knobs.** REJECTED — reimplements the
  session/transcript storage that `sdk-runtime.md` reserves for the SDK; would
  create a second source of truth for the transcript.

## Consequences

- `@theokit/agents` gains a dependency on `@theokit/sdk-tools` (optional peer) and
  raises its `@theokit/sdk` peer floor to `>=2.5.0`. Direction stays main → libs
  (ADR 0030 respected).
- The boundary for future decorator-runtime work is set: a decorator earns runtime
  when it maps to a native SDK field; otherwise it warns metadata-only. New
  declarative features go through the SDK, not a Harness-side IoC container.
- Apps wanting full declarative DI continue to use the external, optional
  `@theokit/di` ecosystem at their own choice — unchanged by M8.
