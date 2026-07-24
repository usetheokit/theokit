# Agent skills

Skills are reusable instruction sets that teach agents how to perform specific tasks.
Instead of cramming everything into one long system prompt, you split capabilities into
focused SKILL.md files — the SDK discovers them and injects them into the agent's context
automatically.

A typical use case: a code assistant agent that needs to know your team's coding standards,
your deploy process, and how to run tests. Write three skills instead of one 800-line system
prompt.

---

## How skills work

1. Create `.theokit/skills/<name>/SKILL.md` for each capability.
2. The SDK discovers all skills under `.theokit/skills/` at startup.
3. Skills are injected into the system prompt as a `<skills>` block — the model reads the
   block and knows which capabilities it has and when to apply them.

```
.theokit/
  skills/
    coding-standards/
      SKILL.md     ← instructions + examples for your team's style
    deploy/
      SKILL.md     ← how to run the deploy pipeline
    testing/
      SKILL.md     ← test conventions and commands
```

---

## Writing a skill

Every SKILL.md has YAML frontmatter followed by the instruction body:

```markdown
---
name: coding-standards
description: Apply team coding standards when reviewing or writing TypeScript code.
category: engineering
---

## TypeScript standards

- Use `const` by default; `let` only when the value changes.
- Prefer named exports over default exports in library code.
- All public functions must have a JSDoc `@param` and `@returns`.
- Maximum cyclomatic complexity of 10 per function.

## Error handling

Always return typed errors. Never swallow exceptions. Pattern:

\`\`\`ts
if (!isValid(input)) {
  return { ok: false, error: 'invalid_input', message: '...' }
}
\`\`\`
```

**Frontmatter fields:**

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Identifier injected into the `<skills>` block |
| `description` | ✅ | One-line summary — the model uses this to decide when the skill applies |
| `category` | — | Informational grouping (not used by the SDK at runtime) |
| `dependencies` | — | Comma-separated list of other skill names this skill builds on |

The body is free-form Markdown. Write examples, commands, rules — whatever the model needs
to behave consistently for this capability.

---

## Auto-discovery

Skills are discovered automatically when `settingSources` includes `"project"` (the default).
No configuration needed — add a `SKILL.md` and restart `theokit dev`.

Discovery behavior:
- Only immediate subdirectories of `.theokit/skills/` are scanned.
- Subdirectories without a `SKILL.md` are silently skipped.
- A SKILL.md with malformed frontmatter is skipped with a warning to stderr; the agent
  continues without it.
- Symlinks that escape the `.theokit/skills/` directory are rejected (security guard).

---

## What the model sees

After discovery, the SDK injects the skill list into the system prompt as a `<skills>` block:

```xml
<skills>
  - coding-standards: Apply team coding standards when reviewing or writing TypeScript code.
  - deploy: Run the deploy pipeline for this project.
  - testing: Test conventions and commands for the test suite.
</skills>
```

The name and description fields are XML-escaped before injection to prevent prompt injection
via user-controlled SKILL.md content. The body of each SKILL.md is NOT included in this
block — only metadata.

> The `<skills>` block tells the model **what it knows**. The body of each SKILL.md is
> available separately via the agent's memory or tool calls — it is not dumped wholesale
> into every request.

To disable auto-injection (for example, when you control the system prompt yourself):

```ts
export default AgentBuilder.create()
  .model('anthropic/claude-sonnet-4-6')
  .skills({ autoInject: false })
  .build()
```

---

## Inspecting loaded skills at runtime

`agent.skills.list()` returns the discovered skills — name and description only, never the
full body:

```ts
import { Agent } from '@theokit/sdk'

const agent = await Agent.create({
  model: 'anthropic/claude-sonnet-4-6',
  local: { cwd: process.cwd() },
})

const skills = await agent.skills.list()
console.log(skills)
// [
//   { name: 'coding-standards', description: '...' },
//   { name: 'deploy', description: '...' },
// ]
```

Use this to display the active skill set in a UI, log it for debugging, or pass it to a
custom system prompt resolver.

---

## Custom skills directory

The auto-discovery reads `.theokit/skills/`. For a custom path — shared skills in a monorepo,
per-environment skill sets — use `discoverSkills()` and `buildSkillsBlock()` from
`@theokit/sdk/skills` and supply a custom `systemPrompt` resolver:

```ts
import { discoverSkills, buildSkillsBlock } from '@theokit/sdk/skills'
import { AgentBuilder } from '@theokit/agents'

// Pick the skills directory at startup
const skillsDir = process.env.SKILLS_DIR ?? '.theokit/skills'
const skills = await discoverSkills(skillsDir, {
  onInvalidSkill: (info) => console.warn(`Skipping skill ${info.name}: ${info.message}`),
})

export default AgentBuilder.create()
  .model('anthropic/claude-sonnet-4-6')
  .skills({ autoInject: false })   // disable built-in injection
  .systemPrompt(async (ctx) => {
    const skillsBlock = buildSkillsBlock(skills)
    return [
      'You are a senior engineer.',
      skillsBlock,
    ].filter(Boolean).join('\n\n')
  })
  .build()
```

`discoverSkills(dir)` accepts any directory — it's not tied to `.theokit/`. This is how you
build agents that ship skill packages or pick skills based on environment.

---

## Skills and the `defineAgent` surface

Skills are discovered automatically when using any agent surface — `defineAgent`,
`AgentBuilder.create()` builder, or `@Agent` class. The `skills` option is available on all three:

```ts
// defineAgent
export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  skills: { autoInject: true },   // default
})

// fluent builder
export default AgentBuilder.create()
  .model('anthropic/claude-sonnet-4-6')
  .skills({ autoInject: false })
  .build()
```

---

## Inline skills + custom directory (M22)

Define a skill in TypeScript without a `SKILL.md` file, and point an agent at a custom skills
directory.

```ts
import { createSkill } from '@theokit/sdk'

const summarize = createSkill({
  name: 'summarize',
  description: 'Summarize text concisely',
  instructions: 'Read the text and produce a 2-sentence summary.',
})

await Agent.create({
  model,
  skills: {
    inline: [summarize],       // code-defined skills (override file skills on name conflict)
    skillsDir: './my-skills',  // custom discovery root instead of .theokit/skills
  },
})
```

Both compose with the per-request enabled-name resolver. `@theokit/sdk@2.20.0`.

## Related

- [Overview](./overview.md) — agents, models, tools in one place
- [Using tools](./using-tools.md) — tools give agents access to data and operations
- [Run context](./run-context.md) — pass per-run config to tool handlers
- [Build a code assistant](../guides/build-a-code-assistant.md) — tutorial that uses skills alongside file tools
