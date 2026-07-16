import { agent } from '@theokit/agents'
import { z } from 'zod'

import { BASE_INSTRUCTIONS } from './prompts/instructions.js'
import { dailyBriefingSkill } from './skills/daily-briefing.js'
import { currentTimeTool } from './tools/current-time.js'
import { sendNotificationTool } from './tools/send-notification.js'
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
  .tool(sendNotificationTool)
  // Human-in-the-loop: gate the side-effecting tool behind an approval. Before the agent runs
  // `send_notification`, the run pauses and the surface shows an approval prompt — allow once/always or
  // reject. Ask the agent to "notify me that …" to see it. Gate any real-world action the same way.
  .approval('send_notification', { question: 'Send this notification?' })
  // Skills the agent can consult on demand (hover `.skills` for how it works).
  .skills([dailyBriefingSkill])
  .build()
