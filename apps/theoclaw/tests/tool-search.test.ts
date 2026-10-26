import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { notEnforced, runControlTurn, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const BRAVE_KEY = 'brave-key-value-7f3a91c2'
const SEARCH_KEY = 'generic-search-key-4b8e10'
const SEARCH_URL = 'https://search.example.test/api'
const OFF_LINE = 'tools: web search is off (no BRAVE_API_KEY or THEOKIT_SEARCH_API_URL)'

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

interface Recorded {
  readonly url: string
  readonly headers: Record<string, string>
}

/** A fetch that records each request and answers with `body` (JSON) and `status`. */
function recordingFetch(body: unknown, status = 200): { readonly fetchImpl: typeof fetch; readonly calls: Recorded[] } {
  const calls: Recorded[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetchImpl, calls }
}

function settingsFor(env: Record<string, string>, fetchImpl?: typeof fetch) {
  return resolveToolSettings(env, tempCwd(cleanups), { detect: notEnforced, warn: () => undefined, ...(fetchImpl ? { fetchImpl } : {}) })
}

function webSearchOf(settings: ReturnType<typeof resolveToolSettings>) {
  const tool = buildTools(settings).find((candidate) => candidate.name === 'web_search')
  if (tool === undefined) throw new Error('no web_search tool was built')
  return tool
}

async function start(...args: Parameters<typeof startForTools>): Promise<ToolStart> {
  const result = await startForTools(...args)
  started.push(result)
  return result
}

describe('web search', () => {
  it('advertises web search over Brave when BRAVE_API_KEY is set', () => {
    const settings = settingsFor({ BRAVE_API_KEY: BRAVE_KEY })
    expect(settings.search.kind).toBe('brave')
    expect(buildTools(settings).map((tool) => tool.name)).toContain('web_search')
  })

  it('advertises no web search and prints one line when no key is set', async () => {
    const settings = settingsFor({})
    expect(buildTools(settings).map((tool) => tool.name)).not.toContain('web_search')
    const result = await start({}, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeUndefined()
    expect(result.output().split('\n').filter((line) => line === OFF_LINE)).toHaveLength(1)
  })

  it('refuses THEOKIT_SEARCH_API_URL without THEOKIT_SEARCH_API_KEY', async () => {
    const result = await start({ THEOKIT_SEARCH_API_URL: SEARCH_URL }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain('THEOKIT_SEARCH_API_KEY')
    expect(result.builds()).toBe(0)
    expect(() => settingsFor({ THEOKIT_SEARCH_API_KEY: SEARCH_KEY })).toThrow('THEOKIT_SEARCH_API_URL')
  })

  it('treats a whitespace-only BRAVE_API_KEY as unset (EC-5)', () => {
    const settings = settingsFor({ BRAVE_API_KEY: '   ' })
    expect(settings.search.kind).toBe('off')
    expect(settings.offLines).toContain(OFF_LINE)
  })

  it('no key value reaches stdout or stderr', async () => {
    const result = await start({ BRAVE_API_KEY: BRAVE_KEY, THEOKIT_SEARCH_API_KEY: SEARCH_KEY, THEOKIT_SEARCH_API_URL: SEARCH_URL }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeUndefined()
    // Whatever writes a key to the masked streams after the start, the mask hides it.
    result.writeThrough(`leak ${BRAVE_KEY} ${SEARCH_KEY}\n`)
    expect(result.output()).not.toContain(BRAVE_KEY)
    expect(result.output()).not.toContain(SEARCH_KEY)
  })

  it('web_search over Brave sends one request to the Brave endpoint with the key header and returns the parsed results — injected fetch', async () => {
    const { fetchImpl, calls } = recordingFetch({ web: { results: [{ title: 'T', url: 'https://r.test', description: 'D' }] } })
    const output = JSON.parse(String(await webSearchOf(settingsFor({ BRAVE_API_KEY: BRAVE_KEY }, fetchImpl)).handler({ query: 'theokit', max_results: 3 })))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.search.brave.com/res/v1/web/search?q=theokit&count=3')
    expect(calls[0]?.headers['X-Subscription-Token']).toBe(BRAVE_KEY)
    expect(output).toMatchObject({ ok: true, results: [{ title: 'T', url: 'https://r.test', snippet: 'D' }] })
  })

  it('web_search over the generic adapter sends GET THEOKIT_SEARCH_API_URL?q= with a Bearer key and returns its results — injected fetch', async () => {
    const { fetchImpl, calls } = recordingFetch({ results: [{ title: 'G', url: 'https://g.test', snippet: 'S' }] })
    const settings = settingsFor({ THEOKIT_SEARCH_API_URL: SEARCH_URL, THEOKIT_SEARCH_API_KEY: SEARCH_KEY }, fetchImpl)
    expect(settings.search.kind).toBe('generic')
    const output = JSON.parse(String(await webSearchOf(settings).handler({ query: 'theo kit', max_results: 2 })))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${SEARCH_URL}?q=theo%20kit&n=2`)
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${SEARCH_KEY}`)
    expect(output).toMatchObject({ ok: true, results: [{ title: 'G', url: 'https://g.test', snippet: 'S' }] })
  })

  it('Brave surfaces a tool error naming the status when the provider answers 5xx', async () => {
    const { fetchImpl } = recordingFetch({ error: 'down' }, 503)
    const output = JSON.parse(String(await webSearchOf(settingsFor({ BRAVE_API_KEY: BRAVE_KEY }, fetchImpl)).handler({ query: 'x' })))
    expect(output.ok).toBe(false)
    expect(JSON.stringify(output)).toContain('503')
  })

  it('the generic adapter returns no results when the provider answers malformed JSON', async () => {
    const { fetchImpl } = recordingFetch('not json {')
    const settings = settingsFor({ THEOKIT_SEARCH_API_URL: SEARCH_URL, THEOKIT_SEARCH_API_KEY: SEARCH_KEY }, fetchImpl)
    const output = JSON.parse(String(await webSearchOf(settings).handler({ query: 'x' })))
    expect(output).toMatchObject({ ok: true, results: [] })
  })

  it('a start with toolDeps.fetchImpl hands the agent a web_search whose call reaches that fetch', async () => {
    const { fetchImpl, calls } = recordingFetch({ web: { results: [] } })
    const result = await start({ BRAVE_API_KEY: BRAVE_KEY }, tempCwd(cleanups), { detect: notEnforced, fetchImpl })
    const options = await runControlTurn(result)
    const search = options.tools.find((tool) => tool.name === 'web_search')
    expect(search).toBeDefined()
    await search?.handler({ query: 'reached' })
    expect(calls.map((call) => call.url)).toEqual(['https://api.search.brave.com/res/v1/web/search?q=reached&count=5'])
  })
})
