---
type: ADR
title: ADR 0006: unifying ConfigurationError on the SDK class
description: Why two ConfigurationError classes silently lost a throw path, and how the re-export fixed instanceof across the boundary.
tags: [adr, errors, sdk]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-24T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/adrs/0006-configuration-error-unification.md }
sources:
  - id: origin
    resource: knowledge-base/adrs/0006-configuration-error-unification.md
    title: Original document, absorbed into this bundle verbatim
    last_modified: 2026-07-24
---

# ADR 0006 — Unify `ConfigurationError` on the SDK's class (M61)

- **Status:** accepted
- **Date:** 2026-07-24
- **Milestone:** M61 (ROADMAP-v2)

## Context

There were **two** `ConfigurationError` classes:

- `@theokit/agents` (`packages/agents/src/errors.ts`) — `class ConfigurationError extends Error`, a
  plain typed authoring failure with only a `name`.
- `@theokit/sdk/errors` — `class ConfigurationError extends TheokitAgentError` (which extends `Error`),
  carrying `{ code?, cause?, metadata?, isRetryable }`.

The agent-builder imported BOTH — the layer's one (through `@theokit/agents`, thrown by capability
validation) and the SDK's (in `agents/subagents/roles.ts`, thrown with `{ code }`). A single
`catch (e instanceof ConfigurationError)` therefore caught one throw path and **silently missed the
other**, depending on which import the catch site used. Two classes with the same name and intent is
exactly the divergence the `SDK → Theokit → AgentBuilder` boundary exists to remove.

## Decision

`@theokit/agents` **re-exports the SDK's `ConfigurationError`** instead of defining its own:

```ts
// packages/agents/src/errors.ts
export { ConfigurationError } from '@theokit/sdk/errors'
```

There is now ONE class. Authoring throws from `@theokit/agents` and runtime throws from
`@theokit/sdk` are the *same constructor*, so `instanceof` holds across the boundary in **both**
directions.

### Why re-export, not `extends`

The M61 objective floated "the Theokit one extends the SDK's". Rejected: a subclass is asymmetric —
`catch (SdkConfigurationError)` would catch the Theokit subclass, but `catch (TheokitConfigurationError)`
would NOT catch a raw SDK throw. Only ONE class makes `instanceof` symmetric, which is the whole point
(the DoD requires it to work "para os dois caminhos"). Re-export is also the parsimony choice (Rung 9):
a subclass with no added behavior would be ceremony.

### Consequences

- The unified class extends `TheokitAgentError` (→ `Error`), so every existing `instanceof Error`
  and `instanceof ConfigurationError` check still holds. The full deterministic suite (623) passes
  unchanged — zero-behavior.
- It gains the SDK's `{ code, cause, metadata }` constructor options. Existing single-arg
  `new ConfigurationError('msg')` calls (all six internal throw sites) are unchanged — options are
  optional.
- `@theokit/agents` now depends on `@theokit/sdk/errors` at `errors.ts` (a leaf). This does NOT
  reintroduce the internal import cycle the module's placement avoids — `@theokit/sdk` is an external
  dependency, not an internal `bridge/`↔`capability/` edge.

## Alternatives considered

- **Keep two classes, document the gap** — rejected: the gap IS the bug (silent missed catches).
- **Theokit `extends` the SDK's** — rejected: asymmetric `instanceof` (see above).
- **SDK re-exports the Theokit one** — rejected: wrong direction (`SDK → Theokit`, the SDK cannot
  depend on the layer) and the SDK's richer class is the correct superset.

# Related
* [layered-oo-boundary](/blueprints/layered-oo-boundary.md) — the research blueprint.
* [sugar-to-oo](/plans/sugar-to-oo.md) — the implementation plan.
* [0005-sugar-to-oo](/decisions/0005-sugar-to-oo.md) — the sugar-to-classes decision.

