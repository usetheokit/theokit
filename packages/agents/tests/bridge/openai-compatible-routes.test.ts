import { describe, expect, it, vi } from 'vitest'

import {
  createOpenAICompatibleRoutes,
  type OpenAIChatRequest,
  type OpenAICompletion,
  renderTranscript,
} from '../../src/bridge/index.js'

const BASE = 'http://127.0.0.1:8080'
const ONE_MIB = 1_048_576

type Complete = (
  request: OpenAIChatRequest,
  onDelta?: (text: string) => void,
) => Promise<string | OpenAICompletion>

function routes(
  complete: Complete = vi.fn<Complete>(async () => 'hello'),
  models: readonly string[] = ['m'],
) {
  return createOpenAICompatibleRoutes({ models, complete })
}

function chat(body: unknown): Request {
  return new Request(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function json(response: Response | undefined): Promise<Record<string, unknown>> {
  if (response === undefined) throw new Error('the handler answered nothing')
  return (await response.json()) as Record<string, unknown>
}

function errorOf(body: Record<string, unknown>): {
  type?: unknown
  param?: unknown
  message?: unknown
} {
  return body.error as { type?: unknown; param?: unknown; message?: unknown }
}

/** A body that streams `size` bytes in 64 KiB chunks and declares no Content-Length. */
function streamedBody(size: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= size) return controller.close()
      const chunk = new Uint8Array(Math.min(65_536, size - sent)).fill(0x61)
      sent += chunk.byteLength
      controller.enqueue(chunk)
    },
  })
}

describe('createOpenAICompatibleRoutes', () => {
  it('lists every configured model in order', async () => {
    const response = await routes(undefined, ['b', 'a', 'c'])(new Request(`${BASE}/v1/models`))

    expect(response?.status).toBe(200)
    const body = await json(response)
    expect(body.object).toBe('list')
    expect(
      (body.data as { id: string; object: string }[]).map((model) => [model.id, model.object]),
    ).toEqual([
      ['b', 'model'],
      ['a', 'model'],
      ['c', 'model'],
    ])
  })

  it('answers a chat completion with the text complete returned', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')
    const request = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] }

    const response = await routes(complete)(chat(request))

    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toContain('application/json')
    const body = await json(response)
    expect(body.object).toBe('chat.completion')
    expect(body.model).toBe('m')
    expect(String(body.id)).toMatch(/^chatcmpl-[0-9a-f-]{36}$/)
    expect(typeof body.created).toBe('number')
    expect(body.choices).toEqual([
      { index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' },
    ])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(request)
  })

  it.each([
    ['non-JSON', 'not json', null],
    ['empty messages', { model: 'm', messages: [] }, 'messages'],
    ['bad role', { model: 'm', messages: [{ role: 'tool', content: 'x' }] }, 'messages.0.role'],
    [
      'bad content part',
      { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 3 }] }] },
      'messages.0.content',
    ],
    ['missing model', { messages: [{ role: 'user', content: 'x' }] }, 'model'],
  ])(
    'refuses a malformed chat body with invalid_body and never calls complete (%s)',
    async (_name, body, param) => {
      const complete = vi.fn<Complete>(async () => 'hello')

      const response = await routes(complete)(chat(body))

      expect(response?.status).toBe(400)
      const error = errorOf(await json(response))
      expect(error.type).toBe('invalid_body')
      if (param === null) expect(error.param).toBeNull()
      else expect(String(error.param)).toMatch(new RegExp(`^${param.replace(/[\\.]/g, '\\$&')}`))
      expect(complete).not.toHaveBeenCalled()
    },
  )

  it('answers 404 model_not_found for a model it does not serve', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')

    const response = await routes(complete)(
      chat({ model: 'other', messages: [{ role: 'user', content: 'hi' }] }),
    )

    expect(response?.status).toBe(404)
    expect(errorOf(await json(response)).type).toBe('model_not_found')
    expect(complete).not.toHaveBeenCalled()
  })

  it('streams chunks ending in [DONE], with usage on the last chunk', async () => {
    const complete = vi.fn<Complete>(async (_request, onDelta) => {
      onDelta?.('he')
      onDelta?.('llo')
      return { text: 'hello', usage: { promptTokens: 3, completionTokens: 2 } }
    })

    const response = await routes(complete)(
      chat({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    )

    expect(response?.headers.get('content-type')).toBe('text/event-stream')
    const frames = (await response!.text()).split('\n\n').filter((f) => f !== '')
    expect(frames.at(-1)).toBe('data: [DONE]')
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f.slice('data: '.length)))
    expect(chunks.every((c) => c.object === 'chat.completion.chunk')).toBe(true)
    expect(chunks.map((c) => c.choices[0].delta.content).join('')).toBe('hello')
    expect(chunks.at(-1).choices[0].finish_reason).toBe('stop')
    expect(chunks.at(-1).usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })
  })

  it('puts usage in the non-stream body', async () => {
    const complete = vi.fn<Complete>(async () => ({
      text: 'hello',
      usage: { promptTokens: 3, completionTokens: 2 },
    }))

    const response = await routes(complete)(
      chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    )

    const body = (await json(response)) as { usage: unknown }
    expect(body.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })
  })

  it('answers 502 turn_failed without the rejection message', async () => {
    const complete = vi.fn<Complete>(async () => {
      throw new Error('secret provider detail')
    })

    const response = await routes(complete)(
      chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    )

    expect(response?.status).toBe(502)
    const text = await response?.text()
    expect(text).not.toContain('secret provider detail')
    const error = errorOf(JSON.parse(String(text)) as Record<string, unknown>)
    expect(error.type).toBe('turn_failed')
    expect(error.message).toBe('the model turn failed')
  })

  it('accepts a body of exactly 1 MiB', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')
    const json = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    const padded = json.slice(0, -1) + ' '.repeat(ONE_MIB - json.length) + '}'
    expect(new TextEncoder().encode(padded).byteLength).toBe(ONE_MIB)

    const response = await routes(complete)(chat(padded))

    expect(response?.status).toBe(200)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('answers 400 invalid_body for an empty body', async () => {
    const response = await routes()(new Request(`${BASE}/v1/chat/completions`, { method: 'POST' }))

    expect(response?.status).toBe(400)
    expect(errorOf(await json(response)).type).toBe('invalid_body')
  })

  it('answers 400 naming a body that could not be read, not a JSON error', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    const request = new Request(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      body: broken,
      duplex: 'half',
    } as RequestInit)

    const response = await routes(complete)(request)

    expect(response?.status).toBe(400)
    const error = errorOf(await json(response))
    expect(error.type).toBe('invalid_body')
    expect(error.message).toBe('the request body could not be read')
    expect(complete).not.toHaveBeenCalled()
  })

  it('answers 405 with an allow header for GET /v1/chat/completions', async () => {
    const response = await routes()(new Request(`${BASE}/v1/chat/completions`))

    expect(response?.status).toBe(405)
    expect(response?.headers.get('allow')).toBe('POST')
  })

  it('answers 413 for a body over 1 MiB', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')

    const response = await routes(complete)(chat('x'.repeat(ONE_MIB + 1)))

    expect(response?.status).toBe(413)
    expect(complete).toHaveBeenCalledTimes(0)
  })

  it('answers 413 for a streamed body with no Content-Length', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')
    const request = new Request(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      body: streamedBody(ONE_MIB + 1),
      duplex: 'half',
    } as RequestInit)
    expect(request.headers.get('content-length')).toBeNull()

    const response = await routes(complete)(request)

    expect(response?.status).toBe(413)
    expect(complete).not.toHaveBeenCalled()
  })

  it('returns undefined for a path it does not own', async () => {
    const handler = routes()

    expect(await handler(new Request(`${BASE}/v1/embeddings`, { method: 'POST' }))).toBeUndefined()
    expect(await handler(new Request(`${BASE}/health`))).toBeUndefined()
    expect(await handler(new Request(`${BASE}/v1/models/extra`))).toBeUndefined()
  })

  it('ignores the extra OpenAI parameters a client sends', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')

    const response = await routes(complete)(
      chat({
        model: 'm',
        temperature: 0.2,
        max_tokens: 16,
        n: 1,
        user: 'u',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    )

    expect(response?.status).toBe(200)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('answers 405 for POST /v1/models', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')

    const response = await routes(complete)(
      new Request(`${BASE}/v1/models`, { method: 'POST', body: '{}' }),
    )

    expect(response?.status).toBe(405)
    expect(errorOf(await json(response)).type).toBe('method_not_allowed')
    expect(complete).not.toHaveBeenCalled()
  })

  it('an image_url content part answers 400 with param messages.0.content.0', async () => {
    const complete = vi.fn<Complete>(async () => 'hello')

    const response = await routes(complete)(
      chat({
        model: 'm',
        messages: [
          { role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://x/y.png' } }] },
        ],
      }),
    )

    expect(response?.status).toBe(400)
    const error = errorOf(await json(response))
    expect(error.type).toBe('invalid_body')
    expect(error.param).toBe('messages.0.content.0')
    expect(complete).not.toHaveBeenCalled()
  })

  it('passes text content parts to complete joined by a newline', async () => {
    const complete = vi.fn<Complete>(async (request) => renderTranscript(request.messages))

    const response = await routes(complete)(
      chat({
        model: 'm',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      }),
    )

    const body = await json(response)
    expect((body.choices as { message: { content: string } }[])[0]?.message.content).toBe('a\nb')
  })
})

describe('renderTranscript', () => {
  it('renders a lone user message verbatim and a longer list as role lines', () => {
    expect(renderTranscript([{ role: 'user', content: 'just this' }])).toBe('just this')
    expect(
      renderTranscript([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ]),
    ).toBe('system: be brief\n\nuser: hi\n\nassistant: hello\n\nuser: again')
  })
})

/**
 * TheoClaw imports these handlers by package name, which resolves `dist/bridge.js` through
 * `package.json#exports`; the tests above read the source. Build first
 * (`pnpm --filter @theokit/agents build`).
 */
describe('the built ./bridge subpath', () => {
  it('exports the OpenAI-compatible routes, the tool route and the capped reader', async () => {
    const built = (await import('@theokit/agents/bridge')) as Record<string, unknown>

    for (const name of [
      'createOpenAICompatibleRoutes',
      'renderTranscript',
      'createToolInvokeRoute',
      'readCappedBody',
      'BodyTooLargeError',
    ]) {
      expect(typeof built[name], name).toBe('function')
    }
  })
})
