import { AgentBuilder } from '@theokit/agents'
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
 * a `/api/agents/tools/weather` endpoint. Add a second agent as another `agents/<name>.ts`.
 *
 * `@theokit/sdk` runs the agent; conversation turns auto-persist per session. Provider is resolved from
 * the environment — OPENROUTER_API_KEY (preferred) OR ANTHROPIC_API_KEY / OPENAI_API_KEY; the model id is
 * provider-prefixed so OpenRouter routes it upstream (https://openrouter.ai/models).
 */
/**
 * Who may run this agent, and against which conversation (ADR 0001).
 *
 * Every agent declares this; `'public'` is the decision, not the absence of one — and it is the
 * honest one for a scaffold with no login. It means: the endpoint resumes whatever conversation the
 * caller names, so anyone holding a session id may read and continue it. That is a capability
 * model, and it is fine while the ids are the random UUIDs the client mints.
 *
 * The moment this app has users, replace it with the owner check:
 *
 * ```ts
 * import { requireOwner } from 'theokit/server/define'
 *
 * export const policy = ({ subject, params }) =>
 *   requireOwner(subject, ownerOfConversation(params.sessionId))
 * ```
 *
 * `subject` is whatever `server/context.ts` put on `ctx.subject`; `params` carries
 * `{ agent, endpoint, sessionId?, approvalId? }`. One declaration covers the run, the thread
 * routes, the approval surface and MCP.
 */
export const policy = 'public'

export default AgentBuilder.create()
  .input(z.object({ message: z.string() }))
  // `LLM_MODEL` is honoured HERE, not by the framework, because this is where the model is
  // declared and this file is yours. `.env.example` documented the variable and nothing read it,
  // so setting it changed the model to exactly what it already was (#398, #408). One expression is
  // cheaper than an override path through the framework, and it keeps the value visible in the file
  // that decides it. The literal stays as the fallback: a scaffold has to run with no environment.
  .model(process.env.LLM_MODEL ?? 'openai/gpt-4o-mini')
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
