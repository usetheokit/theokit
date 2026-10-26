import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One scripted answer of the stub: assistant text, or tool calls the agent will run. */
export type StubReply =
  | { readonly text: string }
  | { readonly toolCalls: readonly { readonly name: string; readonly args: Record<string, unknown> }[] }

export interface ModelStub {
  /** The OpenAI-compatible base URL, for `ModelSelection.url`. */
  readonly url: string
  /** Every request body the stub received, parsed, in arrival order. */
  readonly requests: Record<string, unknown>[]
  close(): Promise<void>
}

function chunk(delta: Record<string, unknown>, finish: string | null): string {
  const body = { id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub', choices: [{ index: 0, delta, finish_reason: finish }] }
  return `data: ${JSON.stringify(body)}\n\n`
}

function streamOf(reply: StubReply): string {
  if ('text' in reply) {
    return chunk({ role: 'assistant', content: reply.text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n'
  }
  const toolCalls = reply.toolCalls.map((call, index) => ({
    index,
    id: `call_${index}`,
    type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }))
  return chunk({ role: 'assistant', tool_calls: toolCalls }, null) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n'
}

/**
 * An OpenAI-compatible chat-completions server on loopback, standing in for the model offline. It
 * answers each `POST …/chat/completions` with the next scripted reply (the last one repeats), as a
 * streaming body, and records the request so a test can read the `tools` the agent advertised.
 */
export async function startModelStub(replies: readonly StubReply[] = [{ text: 'ok' }]): Promise<ModelStub> {
  const requests: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (data: Buffer) => (raw += data.toString()))
    request.on('end', () => {
      if (request.method !== 'POST' || !(request.url ?? '').endsWith('/chat/completions')) {
        response.writeHead(404).end()
        return
      }
      requests.push(JSON.parse(raw) as Record<string, unknown>)
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)] ?? { text: 'ok' }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(streamOf(reply))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** The names of the tools a recorded request advertised. */
export function advertisedTools(request: Record<string, unknown> | undefined): string[] {
  const tools = (request?.tools ?? []) as { function?: { name?: string } }[]
  return tools.map((tool) => tool.function?.name ?? '').sort()
}
