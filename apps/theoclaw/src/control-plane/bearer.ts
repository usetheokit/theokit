import { createHash, timingSafeEqual } from 'node:crypto'

import type { BindEnvironment } from './bind.js'
import { TheoClawConfigError } from './errors.js'

/**
 * The bearer token rules and the one comparison every surface that takes a token uses: the
 * `/control` socket and the `/webchat` chat route (plan D1). A second copy of the comparison would
 * be a second place to get a security check wrong.
 */

/** The shortest bearer token accepted, for every surface. */
export const MIN_BEARER_TOKEN_LENGTH = 32

const BEARER = /^bearer (.+)$/i

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * The token `variable` holds, or `undefined` when it is unset or empty (the surface is then off).
 * A value padded with whitespace is almost always an env file's trailing newline or a quoting slip,
 * and 32 spaces would otherwise switch a surface on: it is refused rather than trimmed, so the value
 * the operator's client sends is the value compared. Every refusal names the variable, never the value.
 */
export function readBearerToken(env: BindEnvironment, variable: string): string | undefined {
  const token = env[variable]
  if (token === undefined || token === '') return undefined
  if (token.trim() !== token) {
    throw new TheoClawConfigError(`${variable} must not begin or end with whitespace`, { variable })
  }
  if (token.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new TheoClawConfigError(`${variable} must be at least ${MIN_BEARER_TOKEN_LENGTH} characters`, {
      variable,
    })
  }
  return token
}

/**
 * A check of an `Authorization` header against `token`: `Bearer <token>`, the scheme in any case.
 * Compared as SHA-256 digests, so the comparison takes the same time whatever the presented length.
 */
export function bearerCheck(token: string): (authorization: string | undefined) => boolean {
  const expected = digest(token)
  return (authorization) => {
    const presented = BEARER.exec(authorization ?? '')?.[1]
    return presented !== undefined && timingSafeEqual(digest(presented), expected)
  }
}
