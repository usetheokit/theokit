---
okf_version: "0.2"
---

# TheoKit knowledge

The framework the agent lives in, and the record of how it got here. Product and
architecture documentation sits alongside the decision trail — grill, blueprint, plan,
review, decision, milestone — so a claim can be traced to the work that produced it.

# Agents
How to build, tool, guard and ship an agent.

* [Agent-to-Agent (A2A)](agents/a2a.md) - Letting another system discover and call your agent, and calling agents that live elsewhere.
* [Coding agents (ACP)](agents/acp.md) - Giving an agent a coding agent — Claude Code, Amp, Codex — as a callable tool.
* [The agent client (useAgent)](agents/agent-client.md) - One hook that talks to any agent on any surface, and the wire format behind it.
* [Channels (messaging webhooks)](agents/channels.md) - Wiring the SDK gateway packages into an app's HTTP surface as messaging channels.
* [Code mode: security boundary and threat model](agents/code-mode.md) - Letting an agent compose tools in code inside an isolation boundary, and the threat model that governs it.
* [Decorator to capability audit](agents/decorator-to-capability.md) - Every exported agent decorator, what it contributed, and the capability that replaced it — the M53 hard gate.
* [Agent feature backlog](agents/feature-backlog.md) - Living record of agent features identified during documentation review, against Mastra parity.
* [Guardrails](agents/guardrails.md) - Blocking jailbreaks, redacting PII before the model sees it, and stopping runaway cost.
* [Human-in-the-loop](agents/human-in-the-loop.md) - Gating agent actions behind a human approval before they run.
* [MCP (Model Context Protocol)](agents/mcp.md) - Connecting an agent to external MCP tool servers without hand-writing the transport.
* [Agent memory](agents/memory.md) - The two memory layers a TheoKit agent has, and when each one applies.
* [Multi-agent patterns](agents/multi-agent.md) - The two composition patterns TheoKit offers when one agent is not enough.
* [Agents](agents/overview.md) - How an agent file in agents/ becomes a live HTTP endpoint, and the anatomy of an agent definition.
* [Processors (lifecycle hooks)](agents/processors.md) - Observing and vetoing every step of an agent run through lifecycle hooks.
* [Vendor agent wrappers](agents/sdk-agents.md) - Wrapping a vendor agent behind a uniform CustomTool so a TheoKit agent can delegate to it.
* [Agent skills](agents/skills.md) - Reusable instruction sets that teach an agent how to perform a specific task.
* [Structured output](agents/structured-output.md) - Returning a typed object from an agent instead of a raw text string.
* [Using tools](agents/using-tools.md) - Giving an agent capabilities beyond language generation: defining, typing and wiring tools.

# Guides
End-to-end walkthroughs.

* [Three ways to define an agent](guides/agent-surfaces.md) - The three authoring surfaces that compile to one runtime, and when to reach for each.
* [Build a code assistant, end to end](guides/build-a-code-assistant.md) - A full walkthrough from empty directory to a working code-assistant chat app.

# Architecture
How the pieces fit and where the seams are.

* [Multi-surface architecture](architecture/multi-surface-architecture.md) - One construction authored once and projected onto every surface an agent app needs.
* [TheoKit and @theokit/sdk integration seam](architecture/theokit-sdk-integration.md) - The canonical manifest for the load-bearing seam between TheoKit and the agent runtime SDK.

# Migration
Moving an app across a breaking version.

* [Migration 0.13 to 0.14: the agent surface clean break](migration/0.13-to-0.14-agent-surface.md) - The hard break on the agent surface, with the removed-exports table and the wire-format change.

# Quality gates
Gates that must hold, and the record they keep.

* [Phase 0 typecheck pre-flight gate (EC-203)](gates/typecheck-pre-flight.md) - The gate that keeps non-SDK TypeScript errors at zero and isolates SDK-rooted ones, plus the run record it accumulated.

# Decisions (ADRs)
What was decided, why, and what it overturns.

* [ADR 0001: patterns budget for capability-based agent authoring](decisions/0001-capability-patterns-budget.md) - Which design patterns the capability layer adopts and which it refuses, each with a reason.
* [ADR 0002: what happens to each agent decorator when the surface is deleted](decisions/0002-decorator-removal-scope.md) - Per-decorator disposition for the M53 removal, the hard gate being a decorator with no capability equivalent.
* [ADR 0002: single-source tool naming at the agents/SDK boundary](decisions/0002-tool-name-single-source.md) - Moving tool-name validation into the single place that mints the name, covering all three SDK rules.
* [ADR 0003: removing every backward-compatibility concession from M55](decisions/0003-no-backcompat-concessions.md) - Why the six compatibility concessions taken in M55 were reverted rather than kept.
* [ADR 0004: opening the LoopStrategy seam](decisions/0004-loop-strategy-seam.md) - Making the agent runner's stop criterion injectable, and moving the termination ceiling into the runner.
* [ADR 0005: the authoring surface is 100% classes](decisions/0005-sugar-to-oo.md) - Converting the free factory functions into classes, and the ADR 0001 premise that reversal overturns.
* [ADR 0006: unifying ConfigurationError on the SDK class](decisions/0006-configuration-error-unification.md) - Why two ConfigurationError classes silently lost a throw path, and how the re-export fixed instanceof across the boundary.

# Blueprints
Prior-art research that fed a decision or a plan.

* [Blueprint: AI-first canonical protocol](blueprints/ai-first-canonical-protocol.md) - The canonical event protocol covering tool-call, tool-result, reasoning and finish.
* [Blueprint: AI-first walking skeleton](blueprints/ai-first-walking-skeleton.md) - The fixture and assertion pattern to mirror, and the RED test shape for the first AI-first milestone.
* [Design spike: composable capabilities for agent authoring](blueprints/capability-oo-design-spike.md) - The object-oriented capability design that replaced metadata-driven decorator authoring.
* [Blueprint: clean break on the proprietary agent surface](blueprints/clean-break-proprietary-surface.md) - Removing the proprietary surface with a migration guide, a BREAKING changelog entry and a grep-to-zero gate.
* [Blueprint: cohesive harness over the SDK](blueprints/cohesive-harness.md) - Wiring the SDK's own primitives into the app harness without building a second agent loop.
* [Blueprint: ecosystem integration guarantee for the TheoKit/SDK seam](blueprints/ecosystem-integration-guarantee.md) - Bringing the TheoKit-to-SDK seam to the drift-guaranteed posture the other seams already have.
* [Blueprint: the layered SDK/TheoKit/AgentBuilder boundary](blueprints/layered-oo-boundary.md) - The four decisions behind eliminating sugar and cutting the direct SDK import from the agent builder.
* [Blueprint: the injectable LoopStrategy seam](blueprints/loop-strategy-seam.md) - Prior art and design for making the runner's stop criterion injectable without risking an infinite loop.
* [Blueprint: TheoKit as the multi-surface presentation layer](blueprints/multi-surface-presentation-layer.md) - A canonical output event and a presenter contract so web and terminal stop re-implementing each other.
* [Blueprint: tool-name contract at the agents/SDK boundary](blueprints/tool-name-single-source.md) - Why a documented namespace path never worked, and where the naming rule has to live instead.
* [Blueprint: unified zero-config agent surface](blueprints/unified-agent-surface.md) - The naming and layout research behind a single zero-config agent surface.

# Plans
What was going to be built, in what order.

* [Plan: surface partial-tool-call as a typed stream event](plans/agents-partial-tool-call-stream.md) - Exposing the SDK's partial-tool-call lifecycle as a typed AgentStreamEvent for progressive tool input.
* [Plan: the capability layer over the existing waist](plans/capability-core.md) - Introducing the capability layer that produces the existing CompiledAgentOptions, proven byte-identical to the decorator path.
* [Plan: open the LoopStrategy seam](plans/loop-strategy-seam.md) - Opening loopStrategy by composition and moving the termination ceiling into the runner.
* [Plan: the presenter package walking skeleton](plans/presenter-layer-skeleton.md) - Creating @theokit/presenter and moving the web translator behind the contract with zero behaviour change.
* [Plan: the free factory functions become classes](plans/sugar-to-oo.md) - Converting the free factory functions into capability classes with zero behaviour change, deleting the functions in the same milestone.
* [Discovery plan: tool-name contract at the agents/SDK boundary](plans/tool-name-single-source-discovery.md) - The research questions asked before designing the tool-name contract.
* [Plan: single-source tool naming, and killing the dead HITL gate code](plans/tool-name-single-source.md) - Making the tool-name rule exist in one place, applied where the name is minted, covering all three SDK rules.

# Reviews
Pre-merge verdicts and the findings behind them.

* [Review: partial-tool-call stream event](reviews/agents-partial-tool-call-stream-2026-07-02.md) - Merge review for the partial-tool-call stream slice, with the cross-repo follow-up it filed.
* [Review: the LoopStrategy seam](reviews/loop-strategy-seam-2026-07-24.md) - Verdict on the LoopStrategy slice, with every actionable finding fixed rather than mitigated.
* [Dependency audit: LoopStrategy seam](reviews/loop-strategy-seam-deps-audit-2026-07-24.md) - CVE and version audit of the dependencies the LoopStrategy slice touches.
* [Review: run-context DI and the fluent type-state builder](reviews/m8-fluent-builder-2026-07-06.md) - The multi-agent review that returned NEEDS_FIXES with three blockers, and how each was closed.
* [Review: presenter layer walking skeleton](reviews/presenter-layer-skeleton-2026-07-23.md) - Verdict on the presenter skeleton, evidenced by the existing web suite repointed without changing an expectation.
* [Review: single-source tool naming](reviews/tool-name-single-source-2026-07-24.md) - Verdict on the tool-name slice, with every HIGH and MEDIUM finding fixed rather than mitigated.
* [Dependency audit: tool-name single source](reviews/tool-name-single-source-deps-audit-2026-07-24.md) - CVE and version audit of the dependencies the tool-name slice touches.
* [Edge case review: tool-name discovery](reviews/tool-name-single-source-edge-cases-2026-07-24.md) - Edge cases surfaced against the tool-name discovery, each with a disposition.
* [Edge case review: tool-name implementation plan](reviews/tool-name-single-source-edge-cases-plan-2026-07-24.md) - Edge cases surfaced against the tool-name implementation plan, each with a disposition.

# Grills
Scope questions answered before a milestone opened.

* [Grill: agent conversation in core](grills/agent-conversation-in-core.md) - Where the React-free thread logic should live so all three surfaces inherit it.
* [Grill: the LoopStrategy seam](grills/loop-strategy-seam.md) - The scope questions confirming the seam slice does not reimplement the loop or add orchestration.
* [Grill: removing the backward-compatibility concessions](grills/no-backcompat-concessions.md) - The scope questions establishing which orphan exported types the removal may touch.
* [Grill: the AI-first roadmap](grills/theokit-ai-first-roadmap.md) - The seven questions answered before the AI-first roadmap was written.
* [Grill: single-source tool naming](grills/tool-name-single-source.md) - The scope questions and the out-of-scope cross-check for the tool-name milestone.
* [Grill: transport unification](grills/transport-unification-4x.md) - The scope questions and the milestone renumbering reconciliation for transport unification.

# Milestone runs
What each milestone actually shipped.

* [Milestone M53: remove the agent decorators completely](milestones/m53-remove-agent-decorators.md) - The atomic decorator removal, its migration guide and the tests deleted along with the code they covered.
* [Milestone M54: open the LoopStrategy seam](milestones/m54-loop-strategy-seam.md) - Closing the runner's OCP asymmetry so the stop criterion is injectable like the other three axes.
* [Milestone M55: single-source tool naming](milestones/m55-tool-name-single-source.md) - Closing the six system-design findings from the review of the tool-name fix.
* [Milestone M56: remove every backward-compatibility concession from M55](milestones/m56-no-backcompat-concessions.md) - Reverting the six compatibility concessions M55 accepted, and the dependency cleanup that came with it.
* [Milestone M7: run-context dependency injection for tools](milestones/m7-run-context.md) - A shared typed run-context set at the agent and injected into every tool handler.
* [Milestone M8: fluent agent builder with type-state](milestones/m8-fluent-builder.md) - A composable agent builder that accumulates type-state so an unsatisfied requirement fails at compile time.

# Releases
Cut releases and what they closed.

* [Release v1.0.0](releases/v1.0.0.md) - The release that completed the V1 roadmap, milestones M0 through M8.

# Reference material
Vocabulary, and pointers to material studied outside this bundle.

* [TheoKit terms](glossary.md) - What the recurring terms in this bundle mean, across the agent surface and the decision trail.
* [Peer reference catalog](references-catalog.md) - The state-of-the-art peer projects gathered at project inception, and what each was studied for.

