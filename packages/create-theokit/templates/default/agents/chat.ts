import { defineAgent } from '@theokit/agents'
import { z } from 'zod'

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
 * Add tools with `defineAgentTool` (from `theokit/server`) and pass them to `tools: [...]`.
 */
export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'openai/gpt-4o-mini',
  system: 'You are a helpful assistant.',
})
