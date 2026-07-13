import { agent } from '@theokit/agents'
import { z } from 'zod'

import { BASE_INSTRUCTIONS } from './prompts/instructions.js'
import { dailyBriefingSkill } from './skills/daily-briefing.js'
import { currentTimeTool } from './tools/current-time.js'
import { weatherTool } from './tools/weather.js'

/**
 * The `chat` agent — served at `POST /api/agents/chat` and bound by `useAgent('chat')`. This file IS the
 * agent; it composes its neighbours under `agents/`: the persona in `prompts/`, capabilities in `tools/`,
 * procedures in `skills/`. Those folders are that concern, NOT extra routes — the framework's scanner
 * treats `prompts/ tools/ skills/ lib/ …` as semantic folders, so `agents/tools/weather.ts` never becomes
 * a `/api/agents/tools/weather` endpoint. Add a second agent as another `agents/<name>.ts`. See
 * `docs/ARCHITECTURE.md`.
 *
 * `@theokit/sdk` runs the agent; conversation turns auto-persist per session. Provider is resolved from
 * the environment — OPENROUTER_API_KEY (preferred) OR ANTHROPIC_API_KEY / OPENAI_API_KEY; the model id is
 * provider-prefixed so OpenRouter routes it upstream (https://openrouter.ai/models).
 */
export default agent()
  .input(z.object({ message: z.string() }))
  .model('openai/gpt-4o-mini')
  .system(BASE_INSTRUCTIONS)
  .tool(weatherTool)
  .tool(currentTimeTool)
  // `.skills([...])` wires the code-defined skill in ONE call: the SDK lists its name + description in a
  // `<skills>` block every turn (cheap, so the model KNOWS it exists) AND auto-provisions a `skill_read`
  // tool the model calls to load the full body on demand (so a long procedure only enters the prompt
  // when needed). Pass a filesystem skill NAME (a string) here too; mix strings + createSkill freely.
  .skills([dailyBriefingSkill])
  .build()
