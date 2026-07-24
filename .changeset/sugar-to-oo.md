---
'@theokit/agents': major
---

Authoring surface is now 100% object-oriented (M57) — the free "sugar" factories are gone.

The ~14 free capability factories and the two free builders are replaced by classes and static
factories, finishing the `X.create()` migration `@theokit/sdk` completed at v3.0. One idiom, aligned
with the runtime this layer wraps.

**BREAKING — mechanical 1:1 rename, no behaviour change:**

```ts
// before                          // after
memory(x)                          new MemoryCapability(x)
skills(x)                          new SkillsCapability(x)
contextWindow(x)                   new ContextWindowCapability(x)
checkpoint(x)                      new CheckpointCapability(x)
subAgents(x)                       new SubAgentsCapability(x)
projectContext(x)                  new ProjectContextCapability(x)
mcpServers(x)                      new McpServersCapability(x)
guardrails(x)                      new GuardrailsCapability(x)
humanInTheLoop(x)                  new HumanInTheLoopCapability(x)
skillsOptions(x)                   new SkillsOptionsCapability(x)
settingSources(x)                  new SettingSourcesCapability(x)
plugins(x)                         new PluginsCapability(x)
runContext(x)                      new RunContextCapability(x)
skillsResolver(x)                  new SkillsResolverCapability(x)
agent()                            AgentBuilder.create()
contextualTool(t)                  ContextualTool.of(t)
```

The nine pure-assignment capabilities share a `FieldCapability` base (one line each); the five that
carry behaviour (validation / delegation / merge / storage-metadata warning) keep the exact body.
`AgentBuilder` / `ContextualTool` are each a type (generic interface) and a value (static factory) at
once — the fluent type-state chain is unchanged.

Zero-behavior: the deterministic suite (608) and type suite (104) pass without editing a single
expectation after repointing call-sites. Reverses ADR 0001 § 4; rationale in
`knowledge-base/adrs/0005-sugar-to-oo.md`.
