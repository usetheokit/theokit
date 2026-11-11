/**
 * Transports for a human account on a chat platform (#1672): same interface as transport.mjs.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
