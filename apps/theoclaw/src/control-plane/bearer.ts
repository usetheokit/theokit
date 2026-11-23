import { GuardConfigError, MIN_BEARER_TOKEN_LENGTH, readBearerToken as readGuardToken } from '@theokit/http/guards'

import type { BindEnvironment } from './bind.js'
import { TheoClawConfigError } from './errors.js'

/**
 * The token `variable` holds, or `undefined` when it is unset or empty (the surface is then off).
 * The rules are the framework's `readBearerToken`; a refusal is the app's `TheoClawConfigError` and
 * names the variable, never the value. The comparison itself is the framework's `bearerCheck`.
 */
export function readBearerToken(env: BindEnvironment, variable: string): string | undefined {
  try {
    return readGuardToken(env, variable, { minLength: MIN_BEARER_TOKEN_LENGTH })
  } catch (error) {
    if (error instanceof GuardConfigError) throw new TheoClawConfigError(error.message, { variable: error.variable })
    throw error
  }
}
