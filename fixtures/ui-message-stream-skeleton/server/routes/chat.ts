import { translateToUIMessageStream, type AgentStreamEvent } from '@theokit/agents'
import { defineRoute, uiMessageStreamResponse } from 'theokit/server'
import { z } from 'zod'

/**
 * M0 walking skeleton — a MANUALLY-wired UIMessageStream endpoint.
 *
 * This is deliberately NOT the `server/agents/` convention (that lands in M2).
 * It wires the two M0 primitives by hand so the shape is explicit:
 *
 *   agent AgentStreamEvent stream
 *     → translateToUIMessageStream(events, { textId })   (@theokit/agents)
 *     → uiMessageStreamResponse(chunks)                  (theokit/server)
 *     → Response on the UIMessageStream wire useChat parses
 *
 * The POINT of M0 is the CLIENT side: `useChat` (see app/page.tsx) consumes this
 * response with NO custom adapter. The server just has to speak the wire.
 *
 * In a real app the events come from the SDK (`@theokit/sdk` `Run.stream()` via
 * the bridge — the only agent runtime). Here we emit a deterministic echo so the
 * skeleton runs without a provider key; swap `echoAgentStream` for your agent's
 * bridged stream and nothing else changes.
 */
async function* echoAgentStream(message: string): AsyncIterable<AgentStreamEvent> {
  yield { type: 'run_started', runId: crypto.randomUUID(), agentName: 'echo' }
  for (const word of `Echo: ${message}`.split(/(\s+)/)) {
    yield { type: 'text_delta', content: word }
  }
  yield {
    type: 'done',
    result: `Echo: ${message}`,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    durationMs: 0,
  }
}

export const POST = defineRoute({
  body: z.object({ messages: z.array(z.object({ role: z.string() })).optional() }),
  handler: async ({ request }): Promise<Response> => {
    const body = (await request.json()) as { messages?: { parts?: { text?: string }[] }[] }
    const last = body.messages?.at(-1)
    const prompt = last?.parts?.map((p) => p.text ?? '').join('') ?? ''
    const events = echoAgentStream(prompt)
    // One shared id per assistant message; randomUUID (G8), not Math.random.
    return uiMessageStreamResponse(
      translateToUIMessageStream(events, { textId: crypto.randomUUID() }),
    )
  },
})
