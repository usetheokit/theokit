import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  MAX_OUTPUT_TOKENS,
  PREFLIGHT_TIMEOUT_MS,
  runPreflight,
} from '../../scripts/live-model-preflight.mjs'
import { MIN_KEY_FRAGMENT, redact } from '../../scripts/redact-provider-keys.mjs'

/**
 * The live-model job's first step sends one request to OpenRouter and prints why it could not
 * run, so a provider outage or a missing secret reads as a named red line in the CI log and never
 * as a pass (B-415, OBJ-9). Every case drives an injected `fetch`, so no test reaches a network.
 */
type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

const SHAPE = /sk-or-v1-[0-9a-f]{16,}/i
const HEX64 = '0123456789abcdef'.repeat(4)
const PREFLIGHT = resolve(__dirname, '../../scripts/live-model-preflight.mjs')

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

  // The provider was reached and answered, so the line must not read as an outage: an empty
  // answer is a configuration or wire-format problem a maintainer fixes (review F-dom-2).
  it.each([
    '{}',
    'not json',
    '{"choices":[{"message":{"content":"  "}}]}',
    '{"choices":[{"message":{"content":[{"type":"text","text":"pong"}]}}]}',
  ])('names a 200 without string content as answered without content: %s', async (body) => {
    const { lines, run } = harness(() => Promise.resolve(new Response(body, { status: 200 })))
    expect(await run).toBe(1)
    expect(lines).toEqual(['provider answered without content (HTTP 200)'])
  })

  it('treats a whitespace-only key as absent', async () => {
    const { lines, fetchImpl, run } = harness(answer('pong'), { OPENROUTER_API_KEY: '   ' })
    expect(await run).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(0)
    expect(lines).toEqual(['provider key absent: the live-model job could not run'])
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
    expect(requestBody(fetchImpl).max_tokens).toBe(MAX_OUTPUT_TOKENS)
    expect(MAX_OUTPUT_TOKENS).toBe(16)
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

  it('redacts a tail of the configured key the answer echoes without its prefix', async () => {
    const key = 'sk-or-v1-' + HEX64
    const { lines, run } = harness(answer(`the key ends ${key.slice(-20)} ok`), {
      OPENROUTER_API_KEY: key,
    })
    expect(await run).toBe(0)
    expect(lines).toEqual(['[live] model response: the key ends *** ok'])
  })

  it('prints a multi-line answer on one line cut at 200 characters', async () => {
    const { lines, run } = harness(answer(`first\r\nsecond\n${'y'.repeat(300)}`))
    expect(await run).toBe(0)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(`[live] model response: first second ${'y'.repeat(300)}`.slice(0, 200))
  })

  it('redacts a key-shaped string that is not the configured key', async () => {
    const { lines, run } = harness(answer('x'.repeat(150) + 'sk-or-v1-' + 'a'.repeat(64)))
    expect(await run).toBe(0)
    for (const line of lines) expect(line).not.toMatch(SHAPE)
  })
})

/**
 * A configured key must never stop the prefix-shape redaction from reaching another key. Measured
 * by the surface-closure audit (F-9fe94e30, case C-25): the configured key's own `sk-or-v1-` is a
 * run of 8 or more of its characters, so redacting that run first removed the prefix the shape
 * needs and the other key's 64 hex digits reached the log whole.
 */
describe('redact', () => {
  const configured = 'sk-or-v1-' + HEX64
  const other = 'sk-or-v1-' + 'f7e6d5c4b3a29180'.repeat(4)

  it('redacts the prefix and every hex digit of another key while a key is configured', () => {
    expect(redact(`other ${other}`, configured)).toBe('other ***')
  })

  it('redacts another key that directly follows a fragment of the configured key', () => {
    const output = redact(`${configured.slice(-20)}${other} end`, configured)
    expect(output).not.toMatch(/[0-9a-f]{8,}/i)
    expect(output).toMatch(/^\*+ end$/)
  })

  it('redacts a prefix-less run of exactly MIN_KEY_FRAGMENT characters of the key', () => {
    const run = configured.slice(20, 20 + MIN_KEY_FRAGMENT)
    expect(MIN_KEY_FRAGMENT).toBe(8)
    expect(redact(`id ${run} end`, configured)).toBe('id *** end')
    expect(redact(`id ${run.slice(1)} end`, configured)).toBe(`id ${run.slice(1)} end`)
  })

  it('redacts a configured key shorter than MIN_KEY_FRAGMENT only when it appears whole', () => {
    expect(redact('a q9z2 b q9z', 'q9z2')).toBe('a *** b q9z')
  })

  it('still redacts a run of the configured key with no prefix next to another key', () => {
    expect(redact(`tail ${configured.slice(-12)} and ${other}`, configured)).toBe(
      'tail *** and ***',
    )
  })
})

/**
 * The workflow runs the preflight as `node scripts/live-model-preflight.mjs`, through the module's
 * `isMain` entry, which no in-process case reaches. If that guard stopped matching, the step would
 * import the module, print nothing and exit 0 (review F-tests-2). The keyless path reaches no
 * network, so it runs here as a process.
 */
describe('live-model-preflight.mjs as a process', () => {
  it('exits 1 and names the absent key when run with no key', () => {
    const result = spawnSync(process.execPath, [PREFLIGHT], { env: {}, encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('provider key absent: the live-model job could not run\n')
    expect(result.status).toBe(1)
  })
})
