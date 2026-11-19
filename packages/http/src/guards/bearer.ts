import { createHash, timingSafeEqual } from 'node:crypto'

import { GuardConfigError } from './errors.js'

/** The default shortest bearer token accepted. */
export const MIN_BEARER_TOKEN_LENGTH = 32

const FLOOR = 16
const BEARER = /^bearer (.+)$/i

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * The token `variable` holds, or `undefined` when it is unset or empty (the surface is off).
 * Whitespace padding is refused rather than trimmed (an env file's newline would otherwise pass),
 * as is a value shorter than `minLength` (default 32, never below 16). Errors name the variable,
 * never the value.
 */
export function readBearerToken(
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  options: { minLength?: number } = {},
): string | undefined {
  const minLength = options.minLength ?? MIN_BEARER_TOKEN_LENGTH
  if (!Number.isInteger(minLength) || minLength < FLOOR) {
    throw new GuardConfigError(
      `minLength for ${variable} must be an integer of at least ${FLOOR}`,
      variable,
    )
  }
  const token = env[variable]
  if (token === undefined || token === '') return undefined
  if (token.trim() !== token) {
    throw new GuardConfigError(`${variable} must not begin or end with whitespace`, variable)
  }
  if (token.length < minLength) {
    throw new GuardConfigError(`${variable} must be at least ${minLength} characters`, variable)
  }
  return token
}

/**
 * A check of an `Authorization` header against `token`: `Bearer <token>`, scheme in any case.
 * Compared as SHA-256 digests, so the time does not depend on the presented length.
 */
export function bearerCheck(token: string): (authorization: string | null | undefined) => boolean {
  const expected = digest(token)
  return (authorization) => {
    const presented = BEARER.exec(authorization ?? '')?.[1]
    return presented !== undefined && timingSafeEqual(digest(presented), expected)
  }
}

/** A guard for a Web Request: `undefined` when allowed, a 401 with `www-authenticate: Bearer` otherwise. */
export function bearerGuard(token: string): (request: Request) => Response | undefined {
  const check = bearerCheck(token)
  return (request) =>
    check(request.headers.get('authorization'))
      ? undefined
      : new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } })
}
