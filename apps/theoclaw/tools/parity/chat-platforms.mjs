/**
 * Matrix and Mattermost parity surfaces (#1672): a scripted human account sends a DM to the bot.
 *
 * Variables the harness reads (never from a file; values stay out of logs, results and command lines).
 * The human account is made on the test server beforehand: on Synapse with the shared-secret admin API
 * (`/_synapse/admin/v1/register`), on Mattermost with a personal access token.
 *
 *   Matrix:     THEOCLAW_PARITY_MATRIX_HOMESERVER_URL, THEOCLAW_PARITY_MATRIX_HUMAN_USER_ID,
 *               THEOCLAW_PARITY_MATRIX_HUMAN_TOKEN, THEOCLAW_PARITY_MATRIX_BOT_USER_ID,
 *               THEOCLAW_PARITY_MATRIX_BOT_TOKEN
 *   Mattermost: THEOCLAW_PARITY_MATTERMOST_BASE_URL, THEOCLAW_PARITY_MATTERMOST_HUMAN_TOKEN,
 *               THEOCLAW_PARITY_MATTERMOST_BOT_TOKEN
 */
import { matrixTransport, mattermostTransport, trimSlashes } from './transport.mjs'

const P = 'THEOCLAW_PARITY_'
export const CHAT_VARIABLES = {
  matrix: [
    'MATRIX_HOMESERVER_URL',
    'MATRIX_HUMAN_USER_ID',
    'MATRIX_HUMAN_TOKEN',
    'MATRIX_BOT_USER_ID',
    'MATRIX_BOT_TOKEN',
  ].map((n) => P + n),
  mattermost: ['MATTERMOST_BASE_URL', 'MATTERMOST_HUMAN_TOKEN', 'MATTERMOST_BOT_TOKEN'].map(
    (n) => P + n,
  ),
}

/** The variables a chat surface needs and `env` lacks. */
export function missingChatVariables(surface, env) {
  return (CHAT_VARIABLES[surface] ?? []).filter((name) => !env[name])
}

async function json(url, init, what) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`)
  return response.json()
}

const bearer = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

/** The env the bot process needs to log in as itself, and the owner entry that admits the human. */
export function chatBotEnv(surface, env) {
  if (surface === 'matrix') {
    return {
      THEOCLAW_MATRIX_HOMESERVER_URL: env[`${P}MATRIX_HOMESERVER_URL`],
      THEOCLAW_MATRIX_ACCESS_TOKEN: env[`${P}MATRIX_BOT_TOKEN`],
      THEOCLAW_MATRIX_USER_ID: env[`${P}MATRIX_BOT_USER_ID`],
    }
  }
  return {
    THEOCLAW_MATTERMOST_BASE_URL: env[`${P}MATTERMOST_BASE_URL`],
    THEOCLAW_MATTERMOST_ACCESS_TOKEN: env[`${P}MATTERMOST_BOT_TOKEN`],
  }
}

/** Every credential value of a chat surface, for redaction. */
export function chatSecrets(env) {
  return Object.values(CHAT_VARIABLES)
    .flat()
    .filter((name) => /TOKEN/.test(name))
    .map((name) => env[name])
    .filter(Boolean)
}

/** Makes the DM, joins the bot by API (gateways#347), and returns the transport plus the owner entry for the human. */
export async function chatSetup(surface, env) {
  if (surface === 'matrix') {
    const homeserver = env[`${P}MATRIX_HOMESERVER_URL`]
    const root = `${trimSlashes(homeserver)}/_matrix/client/v3`
    const humanId = env[`${P}MATRIX_HUMAN_USER_ID`]
    const botId = env[`${P}MATRIX_BOT_USER_ID`]
    const human = env[`${P}MATRIX_HUMAN_TOKEN`]
    const room = await json(
      `${root}/createRoom`,
      {
        method: 'POST',
        headers: bearer(human),
        body: JSON.stringify({ is_direct: true, preset: 'trusted_private_chat', invite: [botId] }),
      },
      'matrix createRoom',
    )
    await json(
      `${root}/join/${encodeURIComponent(room.room_id)}`,
      { method: 'POST', headers: bearer(env[`${P}MATRIX_BOT_TOKEN`]), body: '{}' },
      'matrix bot join',
    )
    return {
      owner: `matrix:${humanId}`,
      transport: matrixTransport({
        homeserver,
        token: human,
        botUserId: botId,
        roomId: room.room_id,
      }),
    }
  }
  const baseUrl = env[`${P}MATTERMOST_BASE_URL`]
  const api = `${trimSlashes(baseUrl)}/api/v4`
  const human = env[`${P}MATTERMOST_HUMAN_TOKEN`]
  const me = await json(`${api}/users/me`, { headers: bearer(human) }, 'mattermost human')
  const bot = await json(
    `${api}/users/me`,
    { headers: bearer(env[`${P}MATTERMOST_BOT_TOKEN`]) },
    'mattermost bot',
  )
  const channel = await json(
    `${api}/channels/direct`,
    { method: 'POST', headers: bearer(human), body: JSON.stringify([me.id, bot.id]) },
    'mattermost direct channel',
  )
  return {
    owner: `mattermost:${me.id}`,
    transport: mattermostTransport({
      baseUrl,
      token: human,
      botUserId: bot.id,
      channelId: channel.id,
    }),
  }
}
