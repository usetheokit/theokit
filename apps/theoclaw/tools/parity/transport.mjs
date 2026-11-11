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
const isFinalFrame = (frame) =>
  frame.type === 'done' || (frame.type === 'error' && frame.code === 'turn_failed')

export function controlTransport({ port, token }) {
  const frames = []
  let socket
  return {
    async send(turn) {
      socket = new WebSocket(`ws://127.0.0.1:${port}/control`, {
        headers: { Authorization: `Bearer ${token}` },
      })
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
      return {
        text,
        matched: match.test(text),
        failed: final === undefined || final.type !== 'done',
        raw: frames,
      }
    },
  }
}

export function webchatTransport({ base, token }) {
  let client
  return {
    async send(turn) {
      const { AgentClient, HttpTransport } = await import('@theokit/agents/client')
      client = new AgentClient(
        new HttpTransport({
          api: `${base}/webchat/chat`,
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      client.send({ message: turn.message })
    },
    async awaitReply(match, timeoutMs) {
      const running = () =>
        client.getSnapshot().status === 'streaming' || client.getSnapshot().status === 'idle'
      await until(() => !running(), timeoutMs)
      const snapshot = client.getSnapshot()
      const text = snapshot.thread
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.parts)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
      return {
        text,
        matched: match.test(text),
        failed: snapshot.status !== 'done',
        raw: snapshot.thread,
      }
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
        const child = spawn(process.execPath, [entry, ...command.map(expand)], {
          cwd: home,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
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
      return {
        text,
        matched: match.test(text),
        failed: last === undefined || results.some((r) => r.code !== 0),
        raw: results,
      }
    },
  }
}

async function api(base, token, path, init = {}) {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    signal: AbortSignal.timeout(30_000),
  })
  // The message carries the path and status only: never a header or a body that could echo a credential.
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} answered ${response.status}`)
  return response.json()
}

/** Collects bot texts via `poll()` until one arrives and then stays quiet for a settle period, or the deadline passes. */
async function collectReply(poll, match, timeoutMs, settleMs = 3_000) {
  const texts = []
  const deadline = Date.now() + timeoutMs
  let last = 0
  while (Date.now() < deadline) {
    const fresh = await poll()
    if (fresh.length > 0) {
      texts.push(...fresh)
      last = Date.now()
    }
    if (texts.length > 0 && (match.test(texts.join('\n')) || Date.now() - last > settleMs)) break
    await sleep(1_000)
  }
  const text = texts.join('\n')
  return { text, matched: match.test(text), failed: false, raw: texts }
}

/**
 * A human user on a Matrix homeserver, in a DM room with the bot. The bot is joined by its own
 * token (it does not join on invite: theokit-gateways#347).
 */
export function matrixTransport({ homeserver, userToken, botUserId, botToken }) {
  const enc = encodeURIComponent
  let roomId
  let seen = new Set()
  return {
    async send(turn) {
      const room = await api(homeserver, userToken, '/_matrix/client/v3/createRoom', {
        method: 'POST',
        body: JSON.stringify({
          is_direct: true,
          invite: [botUserId],
          preset: 'trusted_private_chat',
        }),
      })
      roomId = room.room_id
      await api(homeserver, botToken, `/_matrix/client/v3/join/${enc(roomId)}`, {
        method: 'POST',
        body: '{}',
      })
      const sent = await api(
        homeserver,
        userToken,
        `/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/parity-${Date.now()}`,
        {
          method: 'PUT',
          body: JSON.stringify({ msgtype: 'm.text', body: turn.message }),
        },
      )
      seen = new Set([sent.event_id])
    },
    awaitReply(match, timeoutMs) {
      return collectReply(
        async () => {
          const page = await api(
            homeserver,
            userToken,
            `/_matrix/client/v3/rooms/${enc(roomId)}/messages?dir=b&limit=20`,
          )
          const fresh = (page.chunk ?? []).filter(
            (e) =>
              e.type === 'm.room.message' &&
              e.sender === botUserId &&
              e.content?.msgtype === 'm.text' &&
              !seen.has(e.event_id),
          )
          fresh.forEach((e) => seen.add(e.event_id))
          return fresh.reverse().map((e) => String(e.content.body))
        },
        match,
        timeoutMs,
      )
    },
  }
}

/** A human user with a personal access token, in a DM channel with the bot. */
export function mattermostTransport({ baseUrl, userId, userToken, botUserId }) {
  let channelId
  let since = 0
  const seen = new Set()
  return {
    async send(turn) {
      const channel = await api(baseUrl, userToken, '/api/v4/channels/direct', {
        method: 'POST',
        body: JSON.stringify([userId, botUserId]),
      })
      channelId = channel.id
      const post = await api(baseUrl, userToken, '/api/v4/posts', {
        method: 'POST',
        body: JSON.stringify({ channel_id: channelId, message: turn.message }),
      })
      seen.add(post.id)
      since = post.create_at
    },
    awaitReply(match, timeoutMs) {
      return collectReply(
        async () => {
          const page = await api(
            baseUrl,
            userToken,
            `/api/v4/channels/${channelId}/posts?since=${since}`,
          )
          const posts = Object.values(page.posts ?? {})
            .filter((p) => p.user_id === botUserId && !seen.has(p.id))
            .sort((a, b) => a.create_at - b.create_at)
          posts.forEach((p) => seen.add(p.id))
          return posts.map((p) => String(p.message))
        },
        match,
        timeoutMs,
      )
    },
  }
}
