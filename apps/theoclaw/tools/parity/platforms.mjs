/**
 * Variables for the chat-platform transports (#1672). All come from the environment, never a file.
 * The "user" is the scripted human account; the "bot" is the account theoclaw runs as.
 *
 *   Matrix:     THEOCLAW_PARITY_MATRIX_HOMESERVER_URL, _USER_ID, _USER_TOKEN, _BOT_USER_ID, _BOT_TOKEN
 *   Mattermost: THEOCLAW_PARITY_MATTERMOST_BASE_URL, _USER_ID, _USER_TOKEN, _BOT_USER_ID, _BOT_TOKEN
 */
const P = 'THEOCLAW_PARITY_'
const SPECS = {
  matrix: {
    vars: {
      homeserver: 'MATRIX_HOMESERVER_URL',
      userId: 'MATRIX_USER_ID',
      userToken: 'MATRIX_USER_TOKEN',
      botUserId: 'MATRIX_BOT_USER_ID',
      botToken: 'MATRIX_BOT_TOKEN',
    },
    secrets: ['userToken', 'botToken'],
  },
  mattermost: {
    vars: {
      baseUrl: 'MATTERMOST_BASE_URL',
      userId: 'MATTERMOST_USER_ID',
      userToken: 'MATTERMOST_USER_TOKEN',
      botUserId: 'MATTERMOST_BOT_USER_ID',
      botToken: 'MATTERMOST_BOT_TOKEN',
    },
    secrets: ['userToken', 'botToken'],
  },
}

export const PLATFORM_SURFACES = Object.keys(SPECS)

/** The names of the unset variables for `platform` (empty when it can run). */
export function missingVariables(platform, env) {
  return Object.values(SPECS[platform].vars)
    .filter((name) => !env[P + name])
    .map((name) => P + name)
}

/** `{ config, secrets, botEnv, owner }`: the transport settings, the values to mask, the bot's own env and the human's owner entry. */
export function platformConfig(platform, env) {
  const spec = SPECS[platform]
  const config = Object.fromEntries(
    Object.entries(spec.vars).map(([key, name]) => [key, env[P + name]]),
  )
  const secrets = spec.secrets.map((key) => config[key])
  if (platform === 'matrix') {
    return {
      config,
      secrets,
      owner: `matrix:${config.userId}`,
      botEnv: {
        THEOCLAW_MATRIX_HOMESERVER_URL: config.homeserver,
        THEOCLAW_MATRIX_ACCESS_TOKEN: config.botToken,
        THEOCLAW_MATRIX_USER_ID: config.botUserId,
      },
    }
  }
  return {
    config,
    secrets,
    owner: `mattermost:${config.userId}`,
    botEnv: {
      THEOCLAW_MATTERMOST_BASE_URL: config.baseUrl,
      THEOCLAW_MATTERMOST_ACCESS_TOKEN: config.botToken,
    },
  }
}
