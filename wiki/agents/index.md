# Agents

* [Agent-to-Agent (A2A)](a2a.md) - Letting another system discover and call your agent, and calling agents that live elsewhere.
* [Coding agents (ACP)](acp.md) - Giving an agent a coding agent — Claude Code, Amp, Codex — as a callable tool.
* [The agent client (useAgent)](agent-client.md) - One hook that talks to any agent on any surface, and the wire format behind it.
* [Channels (messaging webhooks)](channels.md) - Wiring the SDK gateway packages into an app's HTTP surface as messaging channels.
* [Code mode: security boundary and threat model](code-mode.md) - Letting an agent compose tools in code inside an isolation boundary, and the threat model that governs it.
* [Decorator to capability audit](decorator-to-capability.md) - Every exported agent decorator, what it contributed, and the capability that replaced it — the M53 hard gate.
* [Agent feature backlog](feature-backlog.md) - Living record of agent features identified during documentation review, against Mastra parity.
* [Guardrails](guardrails.md) - Blocking jailbreaks, redacting PII before the model sees it, and stopping runaway cost.
* [Human-in-the-loop](human-in-the-loop.md) - Gating agent actions behind a human approval before they run.
* [MCP (Model Context Protocol)](mcp.md) - Connecting an agent to external MCP tool servers without hand-writing the transport.
* [Agent memory](memory.md) - The two memory layers a TheoKit agent has, and when each one applies.
* [Multi-agent patterns](multi-agent.md) - The two composition patterns TheoKit offers when one agent is not enough.
* [Agents](overview.md) - How an agent file in agents/ becomes a live HTTP endpoint, and the anatomy of an agent definition.
* [Processors (lifecycle hooks)](processors.md) - Observing and vetoing every step of an agent run through lifecycle hooks.
* [Vendor agent wrappers](sdk-agents.md) - Wrapping a vendor agent behind a uniform CustomTool so a TheoKit agent can delegate to it.
* [Agent skills](skills.md) - Reusable instruction sets that teach an agent how to perform a specific task.
* [Structured output](structured-output.md) - Returning a typed object from an agent instead of a raw text string.
* [Using tools](using-tools.md) - Giving an agent capabilities beyond language generation: defining, typing and wiring tools.
