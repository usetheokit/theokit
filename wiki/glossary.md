---
type: Glossary
title: TheoKit terms
description: What the recurring terms in this bundle mean — the agent surface's vocabulary and the vocabulary of the decision trail that produced it.
tags: [glossary, terminology]
status: stable
generated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z }
sources:
  - id: bundle
    resource: the concepts of this bundle, where each term is used
    title: Usage across this bundle
  - id: cycles
 resource: *.md
    title: The cycle contracts that define the process vocabulary
---

Terms this bundle uses repeatedly. A term whose whole story is one or two sentences lives
here; anything with its own facts and relationships has its own concept and is linked from
its entry.

# The agent surface

Agent
: A file in `agents/` that maps to a live HTTP endpoint. See
  [Agents](/agents/overview.md) for the anatomy.

Agent surface
: The authoring API a developer writes an agent against. There are three of them and they
  compile to one runtime — see [Three ways to define an agent](/guides/agent-surfaces.md).
  "Clean break on the surface" means the old API was deleted rather than deprecated.

Capability
: A two-member contract — a `name` and an `apply` — that enriches the compiled agent options
  instead of inventing a parallel representation. It replaced decorator-based authoring; the
  design is in the [capability design spike](/blueprints/capability-oo-design-spike.md) and
  the per-decorator disposition in
  [ADR 0002](/decisions/0002-decorator-removal-scope.md).

Waist
: The single narrow data structure (`CompiledAgentOptions`) every authoring surface compiles
  down to before the runtime sees it. Because all three surfaces meet there, a new surface can
  be proven equivalent to an old one by comparing at the waist — which is what a
  *zero-behavior proof* does.

Zero-behavior proof
: Evidence that a refactor changed no behaviour: the existing suite is repointed at the new
  code and passes **without editing a single expectation**. Used across
  [sugar to classes](/plans/sugar-to-oo.md) and the
  [presenter skeleton](/plans/presenter-layer-skeleton.md).

LoopStrategy
: The injectable stop criterion of the agent runner — the fourth of its behaviour axes to be
  opened for composition. The termination ceiling lives in the runner, not the strategy, so a
  custom strategy cannot loop forever. See [ADR 0004](/decisions/0004-loop-strategy-seam.md).

Presenter
: The Strategy contract that turns one canonical `AgentOutputEvent` into a surface-specific
  rendering (web stream, terminal ANSI, JSON), so the terminal stops re-implementing the web
  translator. See the [presentation-layer blueprint](/blueprints/multi-surface-presentation-layer.md).

Run-context
: A typed value set once at the agent, overridable per run, injected into every tool handler —
  so tool configuration is declared rather than threaded by hand. Shipped in
  [milestone M7](/milestones/m7-run-context.md).

Type-state builder
: A fluent builder whose accumulated generic parameters make an unsatisfied requirement a
  *compile* error rather than a runtime one. Shipped in
  [milestone M8](/milestones/m8-fluent-builder.md).

Toolbox namespace
: A prefix applied to a tool's name when it is minted. Getting the separator and charset wrong
  produced a documented path that never worked — the whole subject of
  [ADR 0002 on tool naming](/decisions/0002-tool-name-single-source.md).

HITL gate
: A human-in-the-loop approval checkpoint keyed by tool name, which is why it is coupled to
  tool naming. See [Human-in-the-loop](/agents/human-in-the-loop.md).

MCP, ACP, A2A
: The three interop protocols the framework speaks — Model Context Protocol for
  [tool servers](/agents/mcp.md), the Agent Client Protocol for
  [coding agents as tools](/agents/acp.md), and Agent-to-Agent for
  [agents calling agents](/agents/a2a.md).

Mastra
: A competing TypeScript agent framework, used in this bundle only as a parity yardstick —
  the [agent feature backlog](/agents/feature-backlog.md) tracks features found by comparing
  against it.

# The decision trail

The documents in this bundle are the artifacts of a fixed cycle, and each type means something
specific.[^cycles]

Grill
: The interview that resolves scope *before* a milestone opens. It records the questions asked,
  the recommended answer, and the owner's decision — so a later reader can see what was
  deliberately excluded, not just what was built.

Blueprint
: The output of a research pass over prior art. It answers "how did others solve this" with
  cited evidence, and produces no code. A [design spike](/blueprints/capability-oo-design-spike.md)
  is a blueprint that prototypes a design rather than surveying peers.

Plan
: The decomposition of a blueprint into ordered tasks with a test plan and acceptance criteria.
  A discovery plan is the plan *of the research*, not of the implementation — the bundle holds
  both for tool naming ([discovery](/plans/tool-name-single-source-discovery.md),
  [implementation](/plans/tool-name-single-source.md)).

ADR
: Architecture Decision Record. What was decided, the alternatives weighed, and the trigger
  that would reopen it. An ADR may overturn an earlier one — [ADR 0005](/decisions/0005-sugar-to-oo.md)
  reverses a premise of [ADR 0001](/decisions/0001-capability-patterns-budget.md).

Review
: The pre-merge verdict from independent specialist passes. `READY_TO_MERGE` is the only green;
  findings are ranked by severity. An *edge case review* and a *deps audit* are narrower
  reviews of the same slice.

Milestone run
: The record of what a milestone actually shipped — plan, review, release, merge commit — and
  the moment its roadmap checkbox flipped.

Out-of-scope cross-check
: The clause in a grill or milestone confirming a slice does not violate a locked out-of-scope
  item. "Adjacent, not violated" is its verdict when a slice touches the neighbourhood of a
  locked item without crossing it.

# Related
* [Agents](/agents/overview.md) — the surface most of these terms describe.
* [Peer reference catalog](/references-catalog.md) — the prior art the blueprints drew on.

[^cycles]: The cycle contracts in, which define these artifact types and their verdicts.
