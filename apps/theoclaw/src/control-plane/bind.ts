import {
  BindRefusedError,
  GuardConfigError,
  isLoopback,
  parsePort as parseGuardPort,
  resolveBindAddress,
} from '@theokit/http/guards'

import { TheoClawBindError, TheoClawConfigError } from './errors.js'

/** What the bind reads: an environment, never `process.env` itself (NFR-005). */
export type BindEnvironment = Readonly<Record<string, string | undefined>>

export { isLoopback }

/**
 * The address the control plane binds, from the framework's `resolveBindAddress`: `THEOCLAW_HOST`
 * names it and defaults to the loopback; a non-loopback address also needs `THEOCLAW_PUBLIC_BIND=yes`.
 * The generic `HOST` is never read. The refusal is the app's `TheoClawBindError`.
 */
export function resolveControlHost(env: BindEnvironment): string {
  try {
    return resolveBindAddress(env, { hostVariable: 'THEOCLAW_HOST', consentVariable: 'THEOCLAW_PUBLIC_BIND' })
  } catch (error) {
    if (error instanceof BindRefusedError) throw new TheoClawBindError(error.message, { address: error.address })
    throw error
  }
}

/** `THEOCLAW_PORT` through the framework's `parsePort`; the refusal is the app's `TheoClawConfigError`. */
export function parsePort(value: string | undefined): number {
  try {
    return parseGuardPort({ THEOCLAW_PORT: value }, 'THEOCLAW_PORT')
  } catch (error) {
    if (error instanceof GuardConfigError) throw new TheoClawConfigError(error.message, { variable: error.variable })
    throw error
  }
}
