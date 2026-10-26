import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** One chat-completions request the stub received, with when it arrived and when it was answered. */
export interface StubRequest {
  readonly body: { readonly messages: readonly { readonly role: string; readonly content: unknown }[] } & Record<string, unknown>
  readonly receivedAt: number
  respondedAt: number | undefined
}

export interface ModelStubOptions {
  /** How long each answer is held before it is sent. Default 0. */
  readonly delayMs?: number
  /** The reply text for a request; default `reply <n>`, counting from 1. */
  readonly reply?: (request: StubRequest, index: number) => string
  /** Answer HTTP 500 to the requests whose 0-based index this returns true for. */
  readonly fail?: (index: number) => boolean
}

export interface ModelStub {
  /** Base URL for `model.url` or `OPENAI_API_BASE_URL`. */
  readonly url: string
  readonly requests: readonly StubRequest[]
  /** Every user message's text the request carried, in order. */
  userTexts(request: StubRequest): string[]
  close(): Promise<void>
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (body += chunk))
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : '')).join('')
  }
  return ''
}

function chunk(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

/** Answer one request as an OpenAI-compatible SSE stream: the text, a stop, the usage, `[DONE]`. */
function stream(response: ServerResponse, text: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const base = { id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub' }
  chunk(response, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })
  chunk(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  chunk(response, { ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  response.end('data: [DONE]\n\n')
}

/**
 * A loopback OpenAI-compatible model: it records every `POST /v1/chat/completions` body and answers
 * with a streamed reply, after an optional hold. It never reaches the network.
 */
export async function startModelStub(options: ModelStubOptions = {}): Promise<ModelStub> {
  const requests: StubRequest[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const raw = await readBody(request)
      const recorded: StubRequest = { body: JSON.parse(raw) as StubRequest['body'], receivedAt: Date.now(), respondedAt: undefined }
      const index = requests.push(recorded) - 1
      if ((options.delayMs ?? 0) > 0) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      if (options.fail?.(index) === true) {
        response.writeHead(500, { 'content-type': 'application/json' }).end('{"error":{"message":"stub failure"}}')
      } else {
        stream(response, options.reply?.(recorded, index) ?? `reply ${index + 1}`)
      }
      recorded.respondedAt = Date.now()
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the model stub did not bind a TCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    userTexts: (request) => request.body.messages.filter((message) => message.role === 'user').map((message) => textOf(message.content)),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
