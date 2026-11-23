import type { Server } from 'node:http'

import {
  attachControlSocket,
  type DevicePairing,
  type SocketOutcome,
  type SocketVerdict,
} from '@theokit/agents/control'
import { bearerCheck, MIN_BEARER_TOKEN_LENGTH } from '@theokit/http/guards'

import { formatUsageLine, type TurnUsage, usageFrameFields } from '../usage/turn-usage.js'
import type { ControlSessions } from './control-sessions.js'
import { TheoClawConfigError } from './errors.js'
import { MAX_MESSAGE_BYTES } from './limits.js'
import type { TurnRunner } from './turn.js'

export interface ControlSocketOptions {
  /** The bearer token an upgrade must carry; at least 32 characters. */
  readonly token: string
  readonly runTurn: TurnRunner
  /**
   * The named sessions (B-376). Without it a frame naming a session, and every interrupt frame, is
   * `bad_frame`, so a caller that never passes it keeps the sessionless protocol unchanged.
   */
  readonly sessions?: ControlSessions
  /**
   * Device pairing (OC-91). With it an approved device's token opens the socket beside the owner's
   * bearer token, and only an owner socket can issue a setup code or approve a device.
   */
  readonly devices?: DevicePairing
}

/** What the listener holds of the socket server: the clients it must end before closing. */
export interface ControlSocket {
  close(): Promise<void>
}

/** The stderr line a finished turn writes, when it writes one (FR-003: usage; failures and interrupts). */
function turnLine(end: { session?: string; outcome: SocketOutcome }): string | undefined {
  const { session, outcome } = end
  if (outcome.ok) return outcome.usage === undefined ? undefined : formatUsageLine('control', outcome.usage as TurnUsage)
  if (outcome.code === 'interrupted') return session === undefined ? undefined : `theoclaw: control session ${session} turn interrupted`
  return outcome.code === 'turn_failed' ? `theoclaw: turn failed: ${outcome.reason ?? ''}` : undefined
}

/**
 * Serve `/control` on the listener's own server through the framework's `attachControlSocket`: the
 * owner's bearer token, or an approved device's token, opens it; every other upgrade is refused
 * before any agent exists (404 for another path, 401 for a missing or wrong token). Revoking a
 * device ends its open sockets.
 */
export function bindControlSocket(server: Server, options: ControlSocketOptions, stderr: (line: string) => void): ControlSocket {
  if (options.token.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new TheoClawConfigError(`THEOCLAW_CONTROL_TOKEN must be at least ${MIN_BEARER_TOKEN_LENGTH} characters`, {
      variable: 'THEOCLAW_CONTROL_TOKEN',
    })
  }
  const { devices } = options
  const isOwner = bearerCheck(options.token)
  const authorize = (authorization: string | undefined): boolean | SocketVerdict => {
    if (isOwner(authorization)) return { owner: true }
    if (devices?.accepts(authorization) !== true) return false
    const id = devices.deviceIdFor(authorization)
    return { owner: false, revoked: (close) => devices.onRevoke((revoked) => revoked === id && close()) }
  }
  return attachControlSocket(server, {
    authorize,
    runTurn: options.runTurn,
    doneFields: (usage) => usageFrameFields(usage as TurnUsage),
    onTurnEnd: (end) => {
      const line = turnLine(end)
      if (line !== undefined) stderr(line)
    },
    maxPayloadBytes: MAX_MESSAGE_BYTES,
    log: (line) => stderr(`theoclaw: ${line}`),
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    ...(devices === undefined ? {} : { devices }),
  })
}
