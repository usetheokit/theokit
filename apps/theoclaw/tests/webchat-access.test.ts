import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RunningTheoClaw } from '../src/composition.js'
import { startTheoClaw } from '../src/composition.js'
import type { TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { WEBCHAT_ASSETS_DIR } from '../src/webchat/page.js'
import { capturingStream, fakeBuilders, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { assistant, FakeAgent, finished } from './fakes.js'

const TOKEN = 'webchat-token-value-0123456789abcdef'

/**
 * The text a served turn streamed, its `text-delta` parts joined: the reply mask may hold back the
 * end of a delta that could grow into a configured value and release it as a delta of its own
 * (B-398 FR-007), so the text is read the way a client reads it, not as one raw chunk.
 */
function servedText(body: string): string {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice('data: '.length)) as { type?: string; delta?: string })
    .flatMap((part) => (part.type === 'text-delta' && typeof part.delta === 'string' ? [part.delta] : []))
    .join('')
}
const APP_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** A directory holding a built page, so the tests never depend on whether `build:web` ran. */
function builtAssets(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-webchat-assets-'))
  writeFileSync(join(dir, 'app.js'), 'console.log("the page")\n')
  writeFileSync(join(dir, 'app.css'), 'body { margin: 0 }\n')
  return dir
}

const running: RunningTheoClaw[] = []
afterEach(async () => {
  for (const app of running.splice(0)) {
    await app.loop.stopAll()
    await app.close()
  }
})

/**
 * A started TheoClaw that counts the agents it builds: `/control` agents through `agentFactory`, chat
 * agents through `createChatAgent` with the options each was built from, and, with `webchat`, the
 * agents of an `importFreeAgentFactory` (B-375, FR-009).
 */
async function start(options: { readonly token?: string; readonly assetsDir?: string; readonly webchat?: boolean } = {}) {
  const calls = { built: 0, controlBuilt: 0, chatOptions: [] as TheoClawAgentOptions[], importFree: 0, byId: new Map<string, FakeAgent>() }
  const capture = capturingStream()
  const { builders } = fakeBuilders()
  const env = { ...TELEGRAM_AND_LINE, ...(options.token === undefined ? {} : { THEOCLAW_WEBCHAT_TOKEN: options.token }) }
  const app = await startTheoClaw({
    env,
    agentFactory: () => {
      calls.controlBuilt += 1
      return new FakeAgent({ frames: [assistant('a /control agent answered')] })
    },
    // A WebChat turn runs on its chat's session agent, opened as a channel chat's is.
    getOrCreate: async (id, agentOptions) => {
      const open = calls.byId.get(id)
      if (open !== undefined) return Object.assign(open, { dispose: async () => undefined }) as never
      calls.built += 1
      calls.chatOptions.push(agentOptions as TheoClawAgentOptions)
      const agent = new FakeAgent({ frames: [assistant('hello from the agent'), finished()] })
      calls.byId.set(id, agent)
      return Object.assign(agent, { dispose: async () => undefined }) as never
    },
    ...(options.webchat === true
      ? {
          importFreeAgentFactory: () => {
            calls.importFree += 1
            return new FakeAgent({ frames: [assistant('an import-free agent answered'), finished()] })
          },
        }
      : {}),
    builders,
    signals: new EventEmitter(),
    exit: vi.fn(),
    streams: [capture],
    webchatAssetsDir: options.assetsDir ?? builtAssets(),
  })
  running.push(app)
  const base = `http://127.0.0.1:${app.address().port}`
  return { app, base, calls, capture }
}

function post(base: string, path: string, authorization?: string, body: unknown = { message: 'hi', id: 'chat-1' }): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization === undefined ? {} : { authorization }) },
    body: JSON.stringify(body),
  })
}

/** AC-002 (B-368): /webchat is on only with its token, refuses before any agent, and serves the page. */
describe('the /webchat routes on the started listener', () => {
  it('refuses a post with no token and with a wrong token 401, building 0 agents', async () => {
    const { base, calls } = await start({ token: TOKEN })

    expect((await post(base, '/webchat/chat')).status).toBe(401)
    expect((await post(base, '/webchat/chat', `Bearer ${'x'.repeat(40)}`)).status).toBe(401)
    expect(calls.built).toBe(0)
  })

  it('answers 404 on every /webchat path while the token is unset, and says WebChat is off', async () => {
    const { base, calls, capture } = await start()

    for (const path of ['/webchat', '/webchat/assets/app.js', '/webchat/assets/app.css']) {
      expect((await fetch(`${base}${path}`)).status).toBe(404)
    }
    expect((await post(base, '/webchat/chat', `Bearer ${TOKEN}`)).status).toBe(404)
    expect(calls.built).toBe(0)
    expect(capture.text()).toContain('theoclaw: webchat off (THEOCLAW_WEBCHAT_TOKEN unset)\n')
  })

  it('serves the page and both assets with their content types, and 404 for any other asset name', async () => {
    const { base } = await start({ token: TOKEN })

    const page = await fetch(`${base}/webchat`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    const html = await page.text()
    expect(html).toContain('/webchat/assets/app.js')
    expect(html).toContain('/webchat/assets/app.css')
    const script = await fetch(`${base}/webchat/assets/app.js`)
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect(await script.text()).toBe('console.log("the page")\n')
    const style = await fetch(`${base}/webchat/assets/app.css`)
    expect(style.headers.get('content-type')).toContain('text/css')
    expect((await fetch(`${base}/webchat/assets/other.js`)).status).toBe(404)
    expect(page.headers.get('cache-control')).toBe('no-store')
  })

  it('sends the page with a content-security-policy that allows inline styles', async () => {
    const { base } = await start({ token: TOKEN })

    const page = await fetch(`${base}/webchat`)

    expect(page.headers.get('content-security-policy')).toContain("style-src 'self' 'unsafe-inline'")
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('content-security-policy')).toContain("base-uri 'none'")
    expect(page.headers.get('content-security-policy')).toContain("form-action 'none'")
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('answers GET /webchat 503 naming build:web when the bundle is missing', async () => {
    const { base } = await start({ token: TOKEN, assetsDir: mkdtempSync(join(tmpdir(), 'theoclaw-webchat-empty-')) })

    const page = await fetch(`${base}/webchat`)

    expect(page.status).toBe(503)
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(await page.text()).toContain('run the build:web script of the theoclaw package')
  })

  it('sends /webchatx to the webhook router, not to the WebChat routes (EC-4)', async () => {
    const { base } = await start({ token: TOKEN })

    const response = await fetch(`${base}/webchatx`)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).not.toBe('no-store')
  })

  it('answers 404 to GET /webchat/chat, POST /webchat and a dot-dot asset path, building no agent (EC-8)', async () => {
    const { base, calls } = await start({ token: TOKEN })

    expect((await fetch(`${base}/webchat/chat`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404)
    expect((await post(base, '/webchat', `Bearer ${TOKEN}`)).status).toBe(404)
    expect((await fetch(`${base}/webchat/assets/../package.json`)).status).toBe(404)
    expect((await fetch(`${base}/webchat/assets/%2e%2e%2fpackage.json`)).status).toBe(404)
    expect(calls.built).toBe(0)
  })

  it('resolves the default assets directory to apps/theoclaw/dist/web/assets (EC-5)', () => {
    expect(resolve(fileURLToPath(WEBCHAT_ASSETS_DIR))).toBe(join(APP_DIR, 'dist', 'web', 'assets'))
  })

  it('keeps the WebChat token out of stdout and stderr over a start, a refused post and a served turn', async () => {
    const { base, capture } = await start({ token: TOKEN })

    await post(base, '/webchat/chat', `Bearer wrong-${TOKEN}`)
    const served = await post(base, '/webchat/chat', `Bearer ${TOKEN}`)
    expect(servedText(await served.text())).toContain('hello from the agent')
    capture.write(`the token is ${TOKEN}\n`)

    expect(capture.text()).toContain('the token is [redacted]\n')
    expect(capture.text()).not.toContain(TOKEN)
  })

  it('builds the agent of a served turn with no tool, as every chat agent (B-382)', async () => {
    const { base, calls } = await start({ token: TOKEN })

    const served = await post(base, '/webchat/chat', `Bearer ${TOKEN}`)
    expect(servedText(await served.text())).toContain('hello from the agent')

    expect(calls.chatOptions.map((built) => [built.tools, built.plugins, built.mcpServers])).toEqual([
      [undefined, undefined, undefined],
    ])
  })

  it('builds the agent of a served turn through the chat-agent factory, never the /control one (B-377)', async () => {
    const { base, calls } = await start({ token: TOKEN })

    await (await post(base, '/webchat/chat', `Bearer ${TOKEN}`)).text()

    expect(calls.built).toBe(1)
    expect(calls.controlBuilt).toBe(0)
  })

  it('builds a served turn\'s agent through the chat-agent factory even beside an importFreeAgentFactory, so no import reaches it (B-375, FR-009)', async () => {
    const { base, calls } = await start({ token: TOKEN, webchat: true })

    const served = await post(base, '/webchat/chat', `Bearer ${TOKEN}`)
    expect(servedText(await served.text())).toContain('hello from the agent')

    expect(calls.built).toBe(1)
    expect(calls.importFree).toBe(0)
    expect(calls.controlBuilt).toBe(0)
  })

  /** B-703: one session agent per chat id. */
  it('answers a second message of one chat from the agent that has the first in its history', async () => {
    const { base, calls } = await start({ token: TOKEN })

    for (const message of ['first', 'second']) {
      await (await post(base, '/webchat/chat', `Bearer ${TOKEN}`, { message, id: 'chat-1' })).text()
    }

    expect(calls.built).toBe(1)
    expect([...calls.byId.values()].map((agent) => agent.sent)).toEqual([['first', 'second']])
  })

  it('never shares history between two chat ids', async () => {
    const { base, calls } = await start({ token: TOKEN })

    for (const [id, message] of [['chat-a', 'for a'], ['chat-b', 'for b'], ['chat-a', 'again a']] as const) {
      await (await post(base, '/webchat/chat', `Bearer ${TOKEN}`, { message, id })).text()
    }

    expect(calls.built).toBe(2)
    expect(calls.byId.size).toBe(2)
    expect([...calls.byId.values()].map((agent) => agent.sent)).toEqual([['for a', 'again a'], ['for b']])
  })

  it('refuses a post with a missing or malformed chat id 400 with a typed code, building 0 agents', async () => {
    const { base, calls } = await start({ token: TOKEN })

    for (const body of [{ message: 'hi' }, { message: 'hi', id: '' }, { message: 'hi', id: 7 }, { message: 'hi', id: 'a b/../c' }, { message: 'hi', id: 'x'.repeat(200) }]) {
      const response = await post(base, '/webchat/chat', `Bearer ${TOKEN}`, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'chat_id_invalid' } })
    }
    expect(calls.built).toBe(0)
  })
})
