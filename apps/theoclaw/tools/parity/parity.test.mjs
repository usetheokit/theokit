import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { gate } from './gate.mjs'
import { redact, runCli, runScenario, secretValues, verdictFor } from './harness.mjs'
import { missingVariables } from './platforms.mjs'
import { SCENARIOS } from './scenarios.mjs'
import { matrixTransport, mattermostTransport } from './transport.mjs'

const dirs = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('gate', () => {
  const ship = (id, path = 'a.ts') => ({ id, status: 'shipped', check: { path } })
  const run = (over) =>
    gate({
      ledger: [ship('OC-1')],
      baseLedger: [{ id: 'OC-1', status: 'open' }],
      changed: new Set(),
      lastChange: () => '2026-11-01T00:00:00Z',
      readResult: () => undefined,
      ...over,
    })

  it('names a newly shipped item with no result', () => {
    expect(run({})).toEqual([{ id: 'OC-1', why: 'no results/OC-1.json' }])
  })
  it('passes with a works result dated after the last change', () => {
    expect(run({ readResult: () => ({ verdict: 'works', date: '2026-11-02T00:00:00Z' }) })).toEqual(
      [],
    )
  })
  it('fails when a named file changed after the result', () => {
    expect(
      run({ readResult: () => ({ verdict: 'works', date: '2026-10-01T00:00:00Z' }) }),
    ).toHaveLength(1)
  })
  it('refuses a result that is not works', () => {
    expect(
      run({ readResult: () => ({ verdict: 'partial', date: '2026-12-01T00:00:00Z' }) }),
    ).toHaveLength(1)
  })
  it('skips shipped items the change does not touch, and checks them when a named file changes', () => {
    const base = [ship('OC-1')]
    expect(run({ baseLedger: base })).toEqual([])
    expect(run({ baseLedger: base, changed: new Set(['a.ts']) })).toHaveLength(1)
  })
  it('checks everything without a base', () => {
    expect(run({ baseLedger: undefined })).toHaveLength(1)
  })
})

describe('harness', () => {
  it('ships one scenario per surface', () => {
    expect(new Set(SCENARIOS.map((s) => s.surface))).toEqual(
      new Set(['control', 'webchat', 'cli', 'matrix', 'mattermost']),
    )
  })
  it('judges a reply', () => {
    expect(verdictFor({}, { text: 'pong', matched: true, failed: false })).toBe('works')
    expect(verdictFor({}, { text: 'x', matched: false, failed: false })).toBe('partial')
    expect(verdictFor({}, { text: '', matched: false, failed: true })).toBe('broken')
  })
  it('redacts every configured secret', () => {
    const secrets = secretValues({ OPENROUTER_API_KEY: 'sk-secret-value-1', HOME: '/x' }, [
      'tok-abcdefgh',
    ])
    expect(JSON.stringify(redact({ a: 'x sk-secret-value-1 tok-abcdefgh' }, secrets))).not.toMatch(
      /sk-secret|tok-abcdefgh/,
    )
  })
  it('writes a result through a transport and keeps secrets out of it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    dirs.push(dir)
    const env = {
      PATH: process.env.PATH,
      THEOCLAW_PARITY_MODEL: 'm',
      OPENROUTER_API_KEY: 'sk-secret-value-1',
    }
    const makeTransport = () => ({
      async send() {},
      awaitReply: async (match) => ({
        text: 'pong sk-secret-value-1',
        matched: match.test('pong'),
        failed: false,
        raw: [],
      }),
    })
    const result = await runScenario(SCENARIOS[0], { env, makeTransport, resultsDir: dir })
    const text = readFileSync(join(dir, 'OC-22.json'), 'utf8')
    expect(result.verdict).toBe('works')
    expect(text).not.toContain('sk-secret-value-1')
    expect(JSON.parse(text)).toMatchObject({ id: 'OC-22', model: 'm' })
  })
  it('skips and names a scenario with no model', async () => {
    const lines = []
    const code = await runCli(['--all'], {
      env: {},
      out: { log: (l) => lines.push(l), error: (l) => lines.push(l) },
    })
    expect(code).toBe(0)
    expect(lines.filter((l) => l.startsWith('skip OC-22'))).toHaveLength(1)
  })
})

describe('chat platform transports', () => {
  const USER_TOKEN = 'user-token-secret-1'
  const BOT_TOKEN = 'bot-token-secret-1'
  const servers = []
  afterEach(() => servers.splice(0).forEach((s) => s.close()))

  async function serve(handler) {
    const calls = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
        const out = handler(req, body, calls)
        res.setHeader('content-type', 'application/json')
        res.statusCode = out === undefined ? 404 : 200
        res.end(JSON.stringify(out ?? {}))
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    return { base: `http://127.0.0.1:${server.address().port}`, calls }
  }

  it('sends as the Matrix user, joins the bot and reads only the bot reply', async () => {
    const { base, calls } = await serve((req) => {
      if (req.url.endsWith('/createRoom')) return { room_id: '!r:hs' }
      if (req.url.includes('/join/')) return {}
      if (req.url.includes('/send/')) return { event_id: '$mine' }
      if (req.url.includes('/messages')) {
        return {
          chunk: [
            { type: 'm.room.message', sender: '@bot:hs', event_id: '$b', content: { msgtype: 'm.text', body: 'Pong' } },
            { type: 'm.room.message', sender: '@me:hs', event_id: '$mine', content: { msgtype: 'm.text', body: 'ping' } },
          ],
        }
      }
      return undefined
    })
    const t = matrixTransport({ homeserver: base, userToken: USER_TOKEN, botUserId: '@bot:hs', botToken: BOT_TOKEN })
    await t.send({ message: 'ping' })
    const reply = await t.awaitReply(/pong/i, 5000)
    expect(reply).toMatchObject({ text: 'Pong', matched: true, failed: false })
    expect(calls.find((c) => c.url.includes('/join/')).auth).toBe(`Bearer ${BOT_TOKEN}`)
    expect(calls.find((c) => c.url.includes('/send/')).auth).toBe(`Bearer ${USER_TOKEN}`)
    expect(JSON.stringify(reply)).not.toMatch(/secret/)
  })

  it('sends as the Mattermost user and reads the bot post', async () => {
    const { base } = await serve((req) => {
      if (req.url === '/api/v4/channels/direct') return { id: 'ch1' }
      if (req.method === 'POST' && req.url === '/api/v4/posts') return { id: 'p1', create_at: 10 }
      if (req.url.startsWith('/api/v4/channels/ch1/posts')) {
        return { posts: { p1: { id: 'p1', user_id: 'me', message: 'ping', create_at: 10 }, p2: { id: 'p2', user_id: 'bot', message: 'pong', create_at: 11 } } }
      }
      return undefined
    })
    const t = mattermostTransport({ baseUrl: base, userId: 'me', userToken: USER_TOKEN, botUserId: 'bot' })
    await t.send({ message: 'ping' })
    expect(await t.awaitReply(/pong/, 5000)).toMatchObject({ text: 'pong', matched: true })
  })

  it('does not put the token in a failure message', async () => {
    const { base } = await serve(() => undefined)
    const t = mattermostTransport({ baseUrl: base, userId: 'me', userToken: USER_TOKEN, botUserId: 'bot' })
    const error = await t.send({ message: 'x' }).catch((e) => e)
    expect(error.message).toContain('404')
    expect(error.message).not.toContain(USER_TOKEN)
  })

  it('skips each platform scenario by name, without values, and exits zero under --all', async () => {
    const env = { THEOCLAW_PARITY_MODEL: 'm', OPENROUTER_API_KEY: 'sk-secret-value-1', THEOCLAW_PARITY_MATRIX_USER_TOKEN: USER_TOKEN }
    expect(missingVariables('matrix', env)).not.toContain('THEOCLAW_PARITY_MATRIX_USER_TOKEN')
    const lines = []
    const run = async (scenario) => ({ verdict: 'works', id: scenario.id })
    const code = await runCli(['--all'], { env, run, out: { log: (l) => lines.push(l), error: (l) => lines.push(l) } })
    expect(code).toBe(0)
    expect(lines.some((l) => l.startsWith('skip matrix-dm') && l.includes('THEOCLAW_PARITY_MATRIX_HOMESERVER_URL'))).toBe(true)
    expect(lines.some((l) => l.startsWith('skip mattermost-dm'))).toBe(true)
    expect(lines.join('\n')).not.toContain(USER_TOKEN)
  })
})
