# Customization

Common changes, and where they go. See [ARCHITECTURE](./ARCHITECTURE.md) for the full layout.

| I want to…                                          | Edit                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Change the model                                    | `src/server/agents/chat.ts` (`.model(...)`) + the label in `src/shared/agent.ts`                                              |
| Change the persona / rules                          | `src/server/agents/prompts/instructions.ts`                                                                               |
| Add a tool (an action the agent can take)           | new `src/server/agents/tools/<name>.ts`, then `.tool(<name>Tool)` in `src/server/agents/chat.ts`                                     |
| Add a skill (a procedure the model loads on demand) | `Skill.create(...)` in `src/server/agents/skills/<name>.ts`, then add it to `.skills([...])` in `src/server/agents/chat.ts`          |
| Add a second agent                                  | new `src/server/agents/<name>.ts` → auto-served at `/api/agents/<name>`, bind with `useAgent('<name>')`                   |
| Change the greeting / app name                      | `src/shared/agent.ts`                                                                                              |
| Add a backend route                                 | `src/server/routes/<name>.ts`                                                                                      |
| Change the provider key                             | `.env` — `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). See [ENVIRONMENT](./ENVIRONMENT.md) |

## Adding a tool

```ts
// agents/tools/echo.ts
import { tool } from 'theokit/server/define'
import { z } from 'zod'

export const echoTool = tool('echo')
  .describe('Echo the input back.')
  .input(z.object({ text: z.string() }))
  .execute(async ({ text }) => text)
  .build()
```

```ts
// agents/chat.ts
import { echoTool } from './tools/echo.js'
// …
  .tool(weatherTool)
  .tool(echoTool)   // chain as many as you need
  .build()
```
