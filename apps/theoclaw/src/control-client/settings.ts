import { MIN_BEARER_TOKEN_LENGTH } from '../control-plane/bearer.js'
import { parsePort } from '../control-plane/bind.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

/** Where a surface reaches the running instance, and as whom. */
export interface ControlClientSettings {
  /** The instance's `/control` WebSocket URL. */
  readonly url: string
  readonly token: string
  /** The conversation this surface joins; two surfaces on one session share it. */
  readonly session: string
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/

function readToken(env: Readonly<Record<string, string | undefined>>): string {
  const token = env.THEOCLAW_CONTROL_TOKEN ?? ''
  // The message never carries the value: a short token is still most of a secret.
  if (token.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new TheoClawConfigError(`THEOCLAW_CONTROL_TOKEN must be at least ${MIN_BEARER_TOKEN_LENGTH} characters`, {
      variable: 'THEOCLAW_CONTROL_TOKEN',
    })
  }
  return token
}

function readPort(value: string | undefined): number {
  const port = parsePort(value)
  if (port === 0) {
    throw new TheoClawConfigError('THEOCLAW_PORT must name the port the instance listens on, 1 to 65535', {
      variable: 'THEOCLAW_PORT',
    })
  }
  return port
}

/**
 * The surfaces' connection settings (FR-008): `THEOCLAW_CONTROL_TOKEN` (at least 32 characters),
 * `THEOCLAW_PORT`, `THEOCLAW_CONNECT_HOST` (default `127.0.0.1`) and `THEOCLAW_SESSION` (default
 * `owner`). Read only; a refusal names its variable and never the value.
 */
export function readControlClientSettings(env: Readonly<Record<string, string | undefined>>): ControlClientSettings {
  const token = readToken(env)
  const port = readPort(env.THEOCLAW_PORT)
  const host = env.THEOCLAW_CONNECT_HOST ?? '127.0.0.1'
  const session = env.THEOCLAW_SESSION ?? 'owner'
  if (!SESSION_ID.test(session)) {
    throw new TheoClawConfigError('THEOCLAW_SESSION must be 1 to 64 letters, digits, "-" or "_"', {
      variable: 'THEOCLAW_SESSION',
    })
  }
  const authority = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
  return { url: `ws://${authority}/control`, token, session }
}
