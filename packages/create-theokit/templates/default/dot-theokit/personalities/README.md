# Personalities

A personality is a **swappable system prompt**, chosen at runtime without redeploying:

```ts
await agent.usePersonality('teacher') // for this process
await agent.usePersonality('teacher', { save: true }) // persists across restarts
await agent.usePersonality('none') // back to the agent's own system prompt
```

`none`, `default` and `neutral` are reserved names that clear the active preset. History is kept
across a switch — pass `{ reset: true }` to clear the session too.

Each file is markdown: frontmatter describes it, the **body is the system prompt**.

| Frontmatter   | Type     | Meaning                                        |
| ------------- | -------- | ---------------------------------------------- |
| `name`        | string   | the name you pass to `usePersonality`          |
| `description` | string   | shown when listing presets                     |
| `tools`       | string[] | restrict the agent to these tools while active |
| `model`       | string   | override the model while active                |
| `tags`        | string[] | free-form grouping                             |

## Personality, rule, or system prompt?

The three overlap enough that picking wrong is easy, and the difference is _when each one applies_:

|                          | Applies when                                 | Changes at runtime        |
| ------------------------ | -------------------------------------------- | ------------------------- |
| `chat.ts` `.system(...)` | always — it is what the agent IS             | no, it ships in the build |
| a **personality**        | while the user has it active                 | **yes**, `usePersonality` |
| a **rule**               | when the conversation touches matching paths | no, but it is just a file |

Tone and stance belong in a personality. Facts about your domain belong in `THEO.md`. Instructions
about specific code belong in `rules/`.
