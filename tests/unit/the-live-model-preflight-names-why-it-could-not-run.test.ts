import { describe, expect, it, vi } from 'vitest'

import { PREFLIGHT_TIMEOUT_MS, runPreflight } from '../../scripts/live-model-preflight.mjs'

/**
 * The live-model job's first step sends one request to OpenRouter and prints why it could not
 * run, so a provider outage or a missing secret reads as a named red line in the CI log and never
 * as a pass (B-415, OBJ-9). Every case drives an injected `fetch`, so no test reaches a network.
 */
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

const SHAPE = /sk-or-v1-[0-9a-f]{16,}/i
const HEX64 = '0123456789abcdef'.repeat(4)

function harness(
  respond: FetchImpl,
  env: Record<string, string | undefined> = { OPENROUTER_API_KEY: 'sk-or-v1-abc' },
  timeoutMs?: number,
) {
  const lines: string[] = []
  const fetchImpl = vi.fn(respond)
  const run = runPreflight({
    env,
    fetchImpl,
    log: (line: string) => lines.push(line),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  return { lines, fetchImpl, run }
}

function answer(content: string, status = 200): FetchImpl {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
    )
}

function requestBody(fetchImpl: ReturnType<typeof vi.fn>): { model: string; max_tokens: number } {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit
  return JSON.parse(String(init.body)) as { model: string; max_tokens: number }
}

describe('runPreflight', () => {
  it('prints the model response and returns 0 on a 200 with content', async () => {
    const { lines, run } = harness(answer('pong'))
    expect(await run).toBe(0)
    expect(lines.join('\n')).toContain('[live] model response: pong')
  })

  it('names a network error as could-not-be-reached and returns 1', async () => {
    const { lines, run } = harness(() => Promise.reject(new TypeError('fetch failed')))
    expect(await run).toBe(1)
    expect(lines).toContain('provider could not be reached: TypeError: fetch failed')
  })

  it('aborts at the timeout and names it', async () => {
    const waitForAbort: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error)
        })
      })
    const { lines, run } = harness(waitForAbort, undefined, 20)
    expect(await run).toBe(1)
    expect(lines.join('\n')).toMatch(/provider could not be reached: \w*(Timeout|Abort)\w*/)
  })

  it.each([402, 429, 503])('names HTTP %i as could-not-be-reached', async (status) => {
    const { lines, run } = harness(() => Promise.resolve(new Response('', { status })))
    expect(await run).toBe(1)
    expect(lines).toContain(`provider could not be reached: HTTP ${String(status)}`)
  })

  it('prints key-absent and never calls fetch when the key is blank', async () => {
    const { lines, fetchImpl, run } = harness(answer('pong'), {})
    expect(await run).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(0)
    expect(lines).toContain('provider key absent: the live-model job could not run')
  })

  it.each([401, 403])('prints credential-rejected with the code on %i', async (status) => {
    const { lines, run } = harness(() => Promise.resolve(new Response('', { status })))
    expect(await run).toBe(1)
    expect(lines).toContain(`provider rejected the credential (HTTP ${String(status)})`)
  })

  it('names a timeout that fires while the answer is read as could-not-be-reached', async () => {
    const stalled = {
      status: 200,
      ok: true,
      json: () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    } as unknown as Response
    const { lines, run } = harness(() => Promise.resolve(stalled))
    expect(await run).toBe(1)
    expect(lines).toContain('provider could not be reached: TimeoutError: The operation timed out.')
  })

  it('names a 404 as a refused request', async () => {
    const { lines, run } = harness(() => Promise.resolve(new Response('', { status: 404 })))
    expect(await run).toBe(1)
    expect(lines).toContain('provider refused the request (HTTP 404)')
  })

  it.each(['{}', 'not json', '{"choices":[{"message":{"content":"  "}}]}'])(
    'returns 1 on a 200 without content: %s',
    async (body) => {
      const { lines, run } = harness(() => Promise.resolve(new Response(body, { status: 200 })))
      expect(await run).toBe(1)
      expect(lines).toContain('provider could not be reached: answer carried no content (HTTP 200)')
    },
  )

  it('treats a whitespace-only key as absent', async () => {
    const { fetchImpl, run } = harness(answer('pong'), { OPENROUTER_API_KEY: '   ' })
    expect(await run).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(0)
  })

  it('uses the default model when LIVE_MODEL is blank', async () => {
    const { fetchImpl, run } = harness(answer('pong'), {
      OPENROUTER_API_KEY: 'sk-or-v1-abc',
      LIVE_MODEL: '  ',
    })
    await run
    expect(requestBody(fetchImpl).model).toBe('google/gemini-2.5-flash-lite')
  })

  it('asks for 16 output tokens with a 30 s default', async () => {
    const { fetchImpl, run } = harness(answer('pong'))
    await run
    expect(requestBody(fetchImpl).max_tokens).toBe(16)
    expect(PREFLIGHT_TIMEOUT_MS).toBe(30000)
  })

  it('never prints the key value', async () => {
    const key = 'sk-or-v1-' + HEX64.slice(0, 20)
    const { lines, run } = harness(() => Promise.reject(new Error(`bad header ${key}`)), {
      OPENROUTER_API_KEY: key,
    })
    expect(await run).toBe(1)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).not.toContain(key)
  })

  it('redacts the key before truncating the model response', async () => {
    const key = 'sk-or-v1-' + HEX64
    const { lines, run } = harness(answer('x'.repeat(150) + key), { OPENROUTER_API_KEY: key })
    expect(await run).toBe(0)
    for (const line of lines) {
      expect(line).not.toMatch(SHAPE)
      expect(line).not.toContain(key.slice(0, 50))
    }
  })

  it('redacts a key-shaped string that is not the configured key', async () => {
    const { lines, run } = harness(answer('x'.repeat(150) + 'sk-or-v1-' + 'a'.repeat(64)))
    expect(await run).toBe(0)
    for (const line of lines) expect(line).not.toMatch(SHAPE)
  })
})
