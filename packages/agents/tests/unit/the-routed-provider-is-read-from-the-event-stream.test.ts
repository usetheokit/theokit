import { describe, expect, it } from 'vitest'

import {
  describeUpstreams,
  recordRoutedProviders,
  routedProviderOf,
  upstreamLabel,
  upstreamOfTurn,
} from '../live/routed-provider.js'

/**
 * The live prompt-caching test cannot tell an OpenRouter routing miss from a missing cache
 * directive unless it knows which upstream served each turn (B-523). The SDK drops that field, so
 * the live test reads it from the raw chat-completions stream through these helpers. One
 * `describe` per helper (plan D3).
 */
describe('routedProviderOf', () => {
  it('returns the provider of the first chunk that carries one', () => {
    const stream =
      'data: {"id":"g1","choices":[]}\n\n' +
      'data: {"id":"g1","provider":"Anthropic","choices":[]}\n\n' +
      'data: {"id":"g1","provider":"Google","choices":[]}\n\n'
    expect(routedProviderOf(stream)).toBe('Anthropic')
  })

  it('skips a comment line, a [DONE] line and a truncated JSON line before the provider', () => {
    const stream =
      ': OPENROUTER PROCESSING\n\n' +
      'data: [DONE]\n\n' +
      'data: {"id":"g1","provid\n\n' +
      'data: {"id":"g1","provider":"Amazon Bedrock","choices":[]}\n\n'
    expect(routedProviderOf(stream)).toBe('Amazon Bedrock')
  })

  it('returns undefined when no chunk carries a provider', () => {
    const stream = 'data: {"id":"g1","choices":[]}\n\ndata: [DONE]\n'
    expect(routedProviderOf(stream)).toBeUndefined()
    expect(routedProviderOf('')).toBeUndefined()
  })

  it('does not return a provider that is an empty string or not a string', () => {
    const stream =
      'data: {"provider":""}\n\n' +
      'data: {"provider":42}\n\n' +
      'data: {"provider":null}\n\n' +
      'data: "provider"\n\n'
    expect(routedProviderOf(stream)).toBeUndefined()
  })

  it('reads the provider from a stream with CRLF line endings', () => {
    const stream = 'data: {"id":"g1"}\r\n\r\ndata: {"provider":"Anthropic"}\r\n\r\ndata: [DONE]\r\n'
    expect(routedProviderOf(stream)).toBe('Anthropic')
  })

  it('reads a data line with no space after the colon', () => {
    expect(routedProviderOf('data:{"provider":"Google"}\n')).toBe('Google')
  })
})

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const encoder = new TextEncoder()

/**
 * A body that sends `chunks` in order and closes, as a finished stream does. A string chunk is
 * encoded on its own; a byte chunk is sent as it is, so a case can cut inside a character.
 */
function bodyOf(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      controller.close()
    },
  })
}

/**
 * A `fetch` stand-in that answers each call with `respond`, counts the calls and keeps the `init`
 * each one received; no network.
 */
function stubTarget(respond: (input: RequestInfo | URL) => Promise<Response>): {
  target: { fetch: typeof fetch }
  stub: typeof fetch
  calls: () => number
  inits: (RequestInit | undefined)[]
} {
  let count = 0
  const inits: (RequestInit | undefined)[] = []
  const stub: typeof fetch = (input, init) => {
    count += 1
    inits.push(init)
    return respond(input)
  }
  return { target: { fetch: stub }, stub, calls: () => count, inits }
}

/** Wait for `condition`, failing with `what` once `deadlineMs` passes (rules/testing.md § 3). */
async function waitFor(condition: () => boolean, what: string, deadlineMs = 1000): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${String(deadlineMs)} ms: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('recordRoutedProviders', () => {
  it('records the provider of a chat-completions response once the caller has read the body', async () => {
    const { target, calls } = stubTarget(() =>
      Promise.resolve(new Response(bodyOf(['data: {"provider":"Anthropic"}\n\ndata: [DONE]\n\n']))),
    )
    const record = recordRoutedProviders(target)
    await (await target.fetch(CHAT_URL)).text()
    expect(record.providers).toEqual(['Anthropic'])
    expect(calls()).toBe(1)
  })

  it('passes the whole body, the status and the headers through to the caller', async () => {
    const body = 'data: {"id":"g1"}\n\ndata: {"provider":"Anthropic"}\n\ndata: [DONE]\n\n'
    const { target } = stubTarget(() =>
      Promise.resolve(
        new Response(bodyOf([body.slice(0, 10), body.slice(10)]), {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'text/event-stream', 'x-request-id': 'r1' },
        }),
      ),
    )
    recordRoutedProviders(target)
    const response = await target.fetch(CHAT_URL)
    expect(await response.text()).toBe(body)
    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created')
    expect(response.ok).toBe(true)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('x-request-id')).toBe('r1')
  })

  it('records a provider line split across two chunks once the caller has read both', async () => {
    const { target } = stubTarget(() =>
      Promise.resolve(
        new Response(bodyOf(['data: {"provider":"Ama', 'zon Bedrock"}\n\ndata: [DONE]\n\n'])),
      ),
    )
    const record = recordRoutedProviders(target)
    await (await target.fetch(CHAT_URL)).text()
    expect(record.providers).toEqual(['Amazon Bedrock'])
  })

  it('records a provider whose name has a multi-byte character split across two chunks', async () => {
    const bytes = encoder.encode('data: {"provider":"Zürich"}\n\ndata: [DONE]\n\n')
    // 'ü' is the two bytes C3 BC; cut between them so neither chunk holds the whole character.
    const cut = bytes.indexOf(0xc3) + 1
    const { target } = stubTarget(() =>
      Promise.resolve(new Response(bodyOf([bytes.slice(0, cut), bytes.slice(cut)]))),
    )
    const record = recordRoutedProviders(target)
    await (await target.fetch(CHAT_URL)).text()
    expect(record.providers).toEqual(['Zürich'])
  })

  it('reads no provider from a last line the source cut inside a character', async () => {
    // The stream ends on C3, the first byte of a two-byte character. Decoding what is left when
    // the source closes turns that byte into U+FFFD, so the last line is not JSON any more.
    const cutLine = new Uint8Array([...encoder.encode('data: {"provider":"Google"}'), 0xc3])
    const { target } = stubTarget(() =>
      Promise.resolve(new Response(bodyOf(['data: {"id":"g1"}\n\n', cutLine]))),
    )
    const record = recordRoutedProviders(target)
    await (await target.fetch(CHAT_URL)).text()
    expect(record.providers).toEqual([undefined])
  })

  it('hands the caller init to the original fetch, for a chat-completions URL and for another', async () => {
    const { target, inits } = stubTarget(() =>
      Promise.resolve(new Response(bodyOf(['data: {}\n']))),
    )
    recordRoutedProviders(target)
    const chatInit: RequestInit = { method: 'POST', body: '{"stream":true}' }
    const otherInit: RequestInit = { method: 'GET', headers: { authorization: 'Bearer test' } }
    await (await target.fetch(CHAT_URL, chatInit)).text()
    await (await target.fetch('https://openrouter.ai/api/v1/models', otherInit)).text()
    expect(inits).toHaveLength(2)
    expect(inits[0]).toBe(chatInit)
    expect(inits[1]).toBe(otherInit)
  })

  it('records two calls whose responses finish in reverse order in call order', async () => {
    const pending: ((response: Response) => void)[] = []
    const { target } = stubTarget(() => new Promise<Response>((resolve) => pending.push(resolve)))
    const record = recordRoutedProviders(target)
    const first = target.fetch(CHAT_URL)
    const second = target.fetch(CHAT_URL)
    expect(pending).toHaveLength(2)
    pending[1]?.(new Response(bodyOf(['data: {"provider":"Google"}\n\n'])))
    await (await second).text()
    pending[0]?.(new Response(bodyOf(['data: {"provider":"Anthropic"}\n\n'])))
    await (await first).text()
    expect(record.providers).toEqual(['Anthropic', 'Google'])
  })

  it.each([
    ['provider and DONE in one chunk', ['data: {"provider":"Anthropic"}\n\ndata: [DONE]\n\n']],
    ['provider and DONE in two chunks', ['data: {"provider":"Anthropic"}\n\n', 'data: [DONE]\n\n']],
  ])(
    'forwards the caller cancel to a body that sends DONE and never closes (%s)',
    async (_layout, chunks) => {
      let sourceCancelled = false
      const neverCloses = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        },
        cancel() {
          sourceCancelled = true
        },
      })
      const { target } = stubTarget(() => Promise.resolve(new Response(neverCloses)))
      const record = recordRoutedProviders(target)
      const body = (await target.fetch(CHAT_URL)).body
      if (body === null)
        throw new Error('the recorder returned no body for a response that had one')
      const reader = body.getReader()
      const firstRead = await reader.read()
      expect(firstRead.done).toBe(false)
      // Stored while the line passed, not when the source closes: this source never closes.
      expect(record.providers).toEqual(['Anthropic'])
      let text = new TextDecoder().decode(firstRead.value)
      while (!text.includes('[DONE]')) {
        const next = await reader.read()
        if (next.done) throw new Error('the body closed before DONE')
        text += new TextDecoder().decode(next.value)
      }
      await reader.cancel()
      await waitFor(() => sourceCancelled, 'the caller cancel never reached the source body')
    },
  )

  it('returns a chat-completions response with no body unchanged and leaves its slot undefined', async () => {
    const original = new Response(null, { status: 204 })
    const { target } = stubTarget(() => Promise.resolve(original))
    const record = recordRoutedProviders(target)
    const response = await target.fetch(CHAT_URL)
    expect(response).toBe(original)
    expect(response.status).toBe(204)
    expect(record.providers).toEqual([undefined])
  })

  it('reads a last line with no trailing newline when the source closes', async () => {
    const { target } = stubTarget(() =>
      Promise.resolve(
        new Response(bodyOf(['data: {"id":"g1"}\n\n', 'data: {"provider":"Google"}'])),
      ),
    )
    const record = recordRoutedProviders(target)
    await (await target.fetch(CHAT_URL)).text()
    expect(record.providers).toEqual(['Google'])
  })

  it('rethrows the error of a call whose fetch throws and keeps its slot undefined', async () => {
    const failure = new Error('connection reset')
    let call = 0
    const { target } = stubTarget(() => {
      call += 1
      return call === 1
        ? Promise.reject(failure)
        : Promise.resolve(new Response(bodyOf(['data: {"provider":"Anthropic"}\n\n'])))
    })
    const record = recordRoutedProviders(target)
    await expect(target.fetch(CHAT_URL)).rejects.toBe(failure)
    await (await target.fetch(CHAT_URL)).text()
    expect(record.providers).toEqual([undefined, 'Anthropic'])
  })

  it('records nothing for a response to another URL', async () => {
    const { target, calls } = stubTarget(() =>
      Promise.resolve(new Response(bodyOf(['data: {"provider":"Anthropic"}\n\n']))),
    )
    const record = recordRoutedProviders(target)
    await (await target.fetch('https://openrouter.ai/api/v1/models')).text()
    expect(record.providers).toEqual([])
    expect(calls()).toBe(1)
  })

  it('puts the original fetch back on restore()', async () => {
    const { target, stub, calls } = stubTarget(() => Promise.resolve(new Response('ok')))
    const record = recordRoutedProviders(target)
    expect(target.fetch).not.toBe(stub)
    await target.fetch(CHAT_URL)
    record.restore()
    expect(target.fetch).toBe(stub)
    await target.fetch(CHAT_URL)
    expect(calls()).toBe(2)
  })

  it('records a Request object and a URL whose url ends in /chat/completions', async () => {
    const { target } = stubTarget(() =>
      Promise.resolve(new Response(bodyOf(['data: {"provider":"Anthropic"}\n\n']))),
    )
    const record = recordRoutedProviders(target)
    await (await target.fetch(new Request(CHAT_URL, { method: 'POST' }))).text()
    await (await target.fetch(new URL(CHAT_URL))).text()
    expect(record.providers).toEqual(['Anthropic', 'Anthropic'])
  })
})

describe('upstreamOfTurn', () => {
  it('returns the last request of the turn, and undefined for a turn with no request', () => {
    expect(upstreamOfTurn(['A', 'B', 'C'], 0, 2)).toBe('B')
    expect(upstreamOfTurn(['A', 'B', 'C'], 3, 3)).toBeUndefined()
  })
})

describe('upstreamLabel and describeUpstreams', () => {
  const KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)

  it('names both turns in the turn-2 failure message', () => {
    expect(describeUpstreams('Anthropic', 'Google')).toBe(
      'turn 1 upstream=Anthropic, turn 2 upstream=Google',
    )
  })

  it('labels an upstream the stream did not report as (not reported)', () => {
    expect(upstreamLabel(undefined)).toBe('(not reported)')
  })

  it('cuts a label to its first 64 characters', () => {
    const name = 'P'.repeat(100)
    expect(upstreamLabel(name)).toBe('P'.repeat(64))
  })

  it('redacts a key held in the env argument before cutting the label', () => {
    expect(upstreamLabel(`Anthropic ${KEY}`, { OPENROUTER_API_KEY: KEY })).toBe('Anthropic ***')
  })
})
