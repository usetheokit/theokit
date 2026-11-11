/**
 * The transport interface the channel issues implement (#1591):
 *
 *   send(turn): Promise<void>
 *   awaitReply(match: RegExp, timeoutMs: number): Promise<{ text: string, matched: boolean, failed: boolean, raw: unknown }>
 *
 * `awaitReply` resolves with the reply collected so far when the deadline passes or the turn ends;
 * `matched` says whether `match` hit the text; `failed` says the surface reported an error.
 */
import { spawn } from 'node:child_process'

import WebSocket from 'ws'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!condition() && Date.now() < deadline) await sleep(100)
  return condition()
}

const frameEvent = (frame) => (frame.type === 'event' ? frame.event : undefined)
const isFinalFrame = (frame) => frame.type === 'done' || (frame.type === 'error' && frame.code === 'turn_failed')

export function controlTransport({ port, token }) {
  const frames = []
  let socket
  return {
    async send(turn) {
      socket = new WebSocket(`ws://127.0.0.1:${port}/control`, { headers: { Authorization: `Bearer ${token}` } })
      socket.on('message', (raw) => frames.push(JSON.parse(String(raw))))
      await new Promise((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      socket.send(JSON.stringify({ type: 'chat', message: turn.message }))
    },
    async awaitReply(match, timeoutMs) {
      await until(() => frames.some(isFinalFrame), timeoutMs)
      socket?.close()
      const text = frames
        .map(frameEvent)
        .filter((e) => e?.type === 'text_delta' && typeof e.content === 'string')
        .map((e) => e.content)
        .join('')
      const final = frames.find(isFinalFrame)
      return { text, matched: match.test(text), failed: final === undefined || final.type !== 'done', raw: frames }
    },
  }
}

export function webchatTransport({ base, token }) {
  let client
  return {
    async send(turn) {
      const { AgentClient, HttpTransport } = await import('@theokit/agents/client')
      client = new AgentClient(new HttpTransport({ api: `${base}/webchat/chat`, headers: { Authorization: `Bearer ${token}` } }))
      client.send({ message: turn.message })
    },
    async awaitReply(match, timeoutMs) {
      const running = () => client.getSnapshot().status === 'streaming' || client.getSnapshot().status === 'idle'
      await until(() => !running(), timeoutMs)
      const snapshot = client.getSnapshot()
      const text = snapshot.thread
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.parts)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
      return { text, matched: match.test(text), failed: snapshot.status !== 'done', raw: snapshot.thread }
    },
  }
}

/** Runs each command of the turn as a `dist/cli.js` subprocess; the reply is the last one's output. */
export function cliTransport({ entry, env, home, model }) {
  const results = []
  let finished = false
  const expand = (arg) => arg.replaceAll('$HOME', home).replaceAll('$MODEL', model)
  return {
    async send(turn) {
      for (const command of turn.commands) {
        const child = spawn(process.execPath, [entry, ...command.map(expand)], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        child.stdout.on('data', (chunk) => (output += chunk))
        child.stderr.on('data', (chunk) => (output += chunk))
        const code = await new Promise((resolve) => child.once('close', (c) => resolve(c ?? 1)))
        results.push({ command: command[0], code, output })
        if (code !== 0) break
      }
      finished = true
    },
    async awaitReply(match, timeoutMs) {
      await until(() => finished, timeoutMs)
      const last = results.at(-1)
      const text = last?.output ?? ''
      return { text, matched: match.test(text), failed: last === undefined || results.some((r) => r.code !== 0), raw: results }
    },
  }
}

/** `url` without trailing slashes. */
export function trimSlashes(url) {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  return url.slice(0, end)
}

async function getJson(url, init, what) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`)
  return response.json()
}

/** Polls `read()` for the bot's messages until one matches or the deadline passes; resolves with what was collected. */
async function collectBotReply(read, match, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let texts = []
  let raw = []
  for (;;) {
    ;({ texts, raw } = await read())
    if (texts.some((text) => match.test(text)) || Date.now() >= deadline) break
    await sleep(1_000)
  }
  const text = texts.join('\n')
  return { text, matched: match.test(text), failed: false, raw }
}

/** A human Matrix user sending into a DM room with the bot, reading the room timeline (#1672). */
export function matrixTransport({ homeserver, token, botUserId, roomId }) {
  const base = `${trimSlashes(homeserver)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  let sentEventId
  return {
    async send(turn) {
      const txn = `parity-${Date.now()}`
      const body = JSON.stringify({ msgtype: 'm.text', body: turn.message })
      const sent = await getJson(
        `${base}/send/m.room.message/${txn}`,
        { method: 'PUT', headers, body },
        'matrix send',
      )
      sentEventId = sent.event_id
    },
    awaitReply(match, timeoutMs) {
      return collectBotReply(
        async () => {
          const page = await getJson(
            `${base}/messages?dir=b&limit=30`,
            { headers },
            'matrix messages',
          )
          const newer = []
          for (const event of page.chunk ?? []) {
            if (event.event_id === sentEventId) break
            newer.push(event)
          }
          const mine = newer.filter(
            (e) =>
              e.type === 'm.room.message' &&
              e.sender === botUserId &&
              typeof e.content?.body === 'string',
          )
          return { texts: mine.reverse().map((e) => e.content.body), raw: mine }
        },
        match,
        timeoutMs,
      )
    },
  }
}

/** A human Mattermost user posting in a DM channel with the bot, reading it back (#1672). */
export function mattermostTransport({ baseUrl, token, botUserId, channelId }) {
  const api = `${trimSlashes(baseUrl)}/api/v4`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  let sentAt = 0
  return {
    async send(turn) {
      const post = await getJson(
        `${api}/posts`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel_id: channelId, message: turn.message }),
        },
        'mattermost post',
      )
      sentAt = post.create_at ?? Date.now()
    },
    awaitReply(match, timeoutMs) {
      return collectBotReply(
        async () => {
          const page = await getJson(
            `${api}/channels/${encodeURIComponent(channelId)}/posts?per_page=30`,
            { headers },
            'mattermost posts',
          )
          const mine = (page.order ?? [])
            .map((id) => page.posts?.[id])
            .filter((p) => p && p.user_id === botUserId && p.create_at > sentAt)
          mine.sort((a, b) => a.create_at - b.create_at)
          return { texts: mine.map((p) => p.message), raw: mine }
        },
        match,
        timeoutMs,
      )
    },
  }
}
