import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from './harness.mjs'
import { matrixTransport, mattermostTransport } from './chat-transports.mjs'
import { missingVariables } from './platforms.mjs'

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

describe('a bot that never replies', () => {
  it('returns an empty, unmatched reply when the deadline passes', async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(req.url.includes('/posts?') ? { posts: {} } : { id: 'x', create_at: 1 }))
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      const t = mattermostTransport({ baseUrl: base, userId: 'me', userToken: 'tok-aaaaaaaa', botUserId: 'bot' })
      await t.send({ message: 'x' })
      expect(await t.awaitReply(/pong/, 1500)).toMatchObject({ text: '', matched: false })
    } finally {
      server.close()
    }
  })
})
