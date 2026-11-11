import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { gate } from './gate.mjs'
import {
  redact,
  runCli,
  runOpenclawSide,
  runScenario,
  secretValues,
  verdictFor,
} from './harness.mjs'
import { chatSetup, missingChatVariables } from './chat-platforms.mjs'
import { agentArgs, missingSubscription, openclawConfig, replyText } from './openclaw.mjs'
import { SCENARIOS } from './scenarios.mjs'
import { matrixTransport } from './transport.mjs'

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

async function fakeServer(handler) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
      const out = handler(req, body)
      res
        .writeHead(out === undefined ? 404 : 200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(out ?? {}))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() }
}

describe('chat platforms', () => {
  it('skips both scenarios by name without their variables, and exits zero', async () => {
    const lines = []
    const env = { THEOCLAW_PARITY_MODEL: 'm', OPENROUTER_API_KEY: 'sk-secret-value-1' }
    const code = await runCli(['--all'], {
      env,
      scenarios: SCENARIOS.filter((s) => s.id.endsWith('-dm-pong')),
      out: { log: (l) => lines.push(l), error: (l) => lines.push(l) },
    })
    expect(code).toBe(0)
    expect(lines.filter((l) => l.startsWith('skip matrix-dm-pong'))).toHaveLength(1)
    expect(lines.filter((l) => l.startsWith('skip mattermost-dm-pong'))).toHaveLength(1)
    expect(missingChatVariables('matrix', {})).toHaveLength(5)
  })

  it('reads the bot reply from a Matrix timeline, not the human message', async () => {
    const server = await fakeServer((req) => {
      if (req.method === 'PUT') return { event_id: '$mine' }
      return {
        chunk: [
          { event_id: '$bot', type: 'm.room.message', sender: '@bot:x', content: { body: 'pong' } },
          {
            event_id: '$mine',
            type: 'm.room.message',
            sender: '@me:x',
            content: { body: 'ping pong' },
          },
        ],
      }
    })
    const transport = matrixTransport({
      homeserver: server.url,
      token: 'human-token-123',
      botUserId: '@bot:x',
      roomId: '!r:x',
    })
    await transport.send({ message: 'ping' })
    const reply = await transport.awaitReply(/pong/, 2_000)
    server.close()
    expect(reply).toMatchObject({ text: 'pong', matched: true })
    expect(server.seen.every((r) => r.auth === 'Bearer human-token-123')).toBe(true)
  })

  it('reads the bot reply from a Mattermost channel and sets the DM up', async () => {
    const server = await fakeServer((req) => {
      if (req.url.endsWith('/users/me'))
        return { id: req.headers.authorization.includes('bot') ? 'botid' : 'meid' }
      if (req.url.endsWith('/channels/direct')) return { id: 'chan' }
      if (req.method === 'POST') return { create_at: 10 }
      return {
        order: ['p2', 'p1'],
        posts: {
          p1: { user_id: 'meid', create_at: 10, message: 'ping' },
          p2: { user_id: 'botid', create_at: 20, message: 'pong' },
        },
      }
    })
    const env = {
      THEOCLAW_PARITY_MATTERMOST_BASE_URL: server.url,
      THEOCLAW_PARITY_MATTERMOST_HUMAN_TOKEN: 'human-token-123',
      THEOCLAW_PARITY_MATTERMOST_BOT_TOKEN: 'bot-token-1234',
    }
    const { owner, transport } = await chatSetup('mattermost', env)
    await transport.send({ message: 'ping' })
    const reply = await transport.awaitReply(/pong/, 2_000)
    server.close()
    expect(owner).toContain('mattermost:meid')
    expect(reply).toMatchObject({ text: 'pong', matched: true })
  })

  it('masks the chat tokens in a result file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    dirs.push(dir)
    const env = {
      PATH: process.env.PATH,
      THEOCLAW_PARITY_MODEL: 'm',
      OPENROUTER_API_KEY: 'sk-secret-value-1',
      THEOCLAW_PARITY_MATRIX_HUMAN_TOKEN: 'human-token-123',
      THEOCLAW_PARITY_MATRIX_BOT_TOKEN: 'bot-token-12345',
    }
    const makeTransport = () => ({
      async send() {},
      awaitReply: async () => ({
        text: 'pong human-token-123 bot-token-12345',
        matched: true,
        failed: false,
        raw: [],
      }),
    })
    const scenario = SCENARIOS.find((s) => s.id === 'matrix-dm-pong')
    await runScenario(scenario, { env, makeTransport, resultsDir: dir })
    const text = readFileSync(join(dir, 'matrix-dm-pong.json'), 'utf8')
    expect(text).not.toMatch(/human-token-123|bot-token-12345/)
  })

  it('does not match when the bot stays silent', async () => {
    const server = await fakeServer((req) =>
      req.method === 'PUT' ? { event_id: '$mine' } : { chunk: [{ event_id: '$mine' }] },
    )
    const transport = matrixTransport({
      homeserver: server.url,
      token: 'human-token-123',
      botUserId: '@bot:x',
      roomId: '!r:x',
    })
    await transport.send({ message: 'ping' })
    const reply = await transport.awaitReply(/pong/, 50)
    server.close()
    expect(reply).toMatchObject({ text: '', matched: false })
  })
})

describe('openclaw side (#1673)', () => {
  const sub = 'openai-chatgpt/gpt-5.6-luna'
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), 'parity-home-'))
    dirs.push(h)
    mkdirSync(join(h, '.theokit'))
    writeFileSync(join(h, '.theokit', 'auth.json'), '{}')
    return h
  }
  const quiet = () => {
    const lines = []
    return { lines, out: { log: (l) => lines.push(l), error: (l) => lines.push(l) } }
  }

  it('writes both verdicts with reply, version and one model id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    dirs.push(dir)
    const env = { PATH: process.env.PATH, HOME: home(), THEOCLAW_PARITY_MODEL: sub }
    const run = async (scenario) => {
      const result = {
        id: scenario.id,
        verdict: 'works',
        reply: 'pong',
        model: sub,
        versions: { theoclaw: '1.2.3' },
      }
      writeFileSync(join(dir, `${scenario.id}.json`), JSON.stringify(result))
      return result
    }
    const runner = async () => ({
      text: 'pong',
      matched: true,
      failed: false,
      version: '2026.11.3',
    })
    const { out } = quiet()
    const code = await runCli(['--id', 'OC-22', '--side', 'both'], {
      env,
      out,
      run,
      runOpenclawTurn: (s, o) => runOpenclawSide(s, { ...o, runner, resultsDir: dir }),
    })
    const written = JSON.parse(readFileSync(join(dir, 'OC-22.json'), 'utf8'))
    expect(code).toBe(0)
    expect(written.theoclaw).toMatchObject({
      verdict: 'works',
      reply: 'pong',
      version: '1.2.3',
      model: sub,
    })
    expect(written.openclaw).toMatchObject({
      verdict: 'works',
      reply: 'pong',
      version: '2026.11.3',
      model: sub,
    })
  })

  it('exits non-zero naming the missing login before starting either product', async () => {
    const started = []
    const { lines, out } = quiet()
    const env = { HOME: mkdtempSync(join(tmpdir(), 'parity-home-')), THEOCLAW_PARITY_MODEL: sub }
    dirs.push(env.HOME)
    const code = await runCli(['--id', 'OC-22', '--side', 'both'], {
      env,
      out,
      run: async () => started.push('theoclaw'),
      runOpenclawTurn: async () => started.push('openclaw'),
    })
    expect(code).not.toBe(0)
    expect(lines.join('\n')).toMatch(/subscription login/)
    expect(started).toEqual([])
  })

  it('refuses a model that is not on the subscription route, and a bad side', async () => {
    expect(missingSubscription({ HOME: home(), THEOCLAW_PARITY_MODEL: 'x/y' }).join()).toMatch(
      /openai-chatgpt/,
    )
    const { out } = quiet()
    expect(await runCli(['--id', 'OC-22', '--side', 'nope'], { env: {}, out })).toBe(2)
  })

  it('marks surfaces OpenClaw cannot be asked as skipped, and builds its inputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'parity-test-'))
    dirs.push(dir)
    const result = await runOpenclawSide(
      SCENARIOS.find((s) => s.id === 'OC-12'),
      { env: { THEOCLAW_PARITY_MODEL: sub }, resultsDir: dir },
    )
    expect(result.openclaw.verdict).toBe('skipped')
    expect(openclawConfig({ model: sub, port: 1, token: 't' }).agents.defaults.model.primary).toBe(
      sub,
    )
    expect(agentArgs('hi', { token: 't', port: 1 })).toContain('--message')
    expect(replyText('{"payloads":[{"text":"pong"}]}')).toBe('pong')
  })
})
