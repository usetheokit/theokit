import { agent } from '@theokit/agents'
import { z } from 'zod'

import { BASE_INSTRUCTIONS } from './_lib/instructions.js'
import { weatherTool } from './_tools/weather.js'

/**
 * Chat agent — the zero-config `agents/*.ts` convention.
 *
 * This one file is auto-served at `POST /api/agents/chat` (dev + build), streaming the
 * ai-sdk `UIMessageStream` that `useAgent('chat')` consumes on the client. No manual route,
 * no manual client wiring. `@theokit/sdk` runs it; conversation turns auto-persist per
 * session (the SDK owns storage).
 *
 * Provider: resolved from the environment — OPENROUTER_API_KEY (preferred — gateway to many
 * models) OR ANTHROPIC_API_KEY / OPENAI_API_KEY. The `model` id is prefixed with the provider
 * namespace so OpenRouter routes it upstream (see https://openrouter.ai/models).
 *
 * The agent is composed from its neighbours (see `docs/ARCHITECTURE.md`): the persona lives in
 * `agents/_lib/instructions.ts` and tools in `agents/_tools/` (both underscore-prefixed so the
 * route scanner skips them). Add a tool with `tool('name')…build()` and chain it via `.tool(...)`;
 * add a skill as `agents/skills/<name>.md`.
 */
export default agent()
  .input(z.object({ message: z.string() }))
  .model('openai/gpt-4o-mini')
  .system(BASE_INSTRUCTIONS)
  .tool(weatherTool)
  .build()
