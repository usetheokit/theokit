import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import { Authenticated } from '../../src/server/auth/authenticated-guard.js'
import { createSessionManagerWeb } from '../../src/server/auth/session.js'
import { subjectFromContext } from '../../src/core/contracts/route-policy.js'

/**
 * `Authenticated(sessions)` — the guard every adopter used to write (usetheokit/theokit#574).
 *
 * The issue's first half shipped (`@Public()`); this is the second, and it is the one that hands a
 * consumer a security primitive rather than a convenience. What these assert is the shape of the
 * near-miss that motivated it: a guard reading the subject off the ExecutionContext denied EVERYONE
 * and passed the only test aimed at it, because that test asserted an unauthenticated request is
 * refused. So the load-bearing case here is the POSITIVE one — a caller with a session gets in.
 */

/** Stands in for the controller class a guard is told about; this guard never reads it. */
class Probe {
  readonly name = 'probe'
}

/** A context of exactly the shape `@theokit/http` builds for a guard: no `subject` on it. */
const contextFor = (request: Request) => ({
  getRequest: () => request,
  getUrl: () => new URL(request.url),
  getClass: () => Probe,
  getMethodName: () => 'handler',
})

/** 32+ chars, which `createSessionManagerWeb` enforces. Not a credential — a test fixture. */
// `openssl rand -hex 32`-shaped. A fixture that trips the production guard (#610) is one the
// suite reports as a warning on every run, which is how a warning stops being read.
const SECRET = 'f1490bcc329b9950ad9270ad27d696ac687504b0013e49ebeabefd883292dbc4'

const withCookie = async (
  sessions: ReturnType<typeof createSessionManagerWeb<{ userId: string }>>,
  data: { userId: string },
): Promise<Request> => {
  const headers = new Headers()
  await sessions.createSession(headers, data)
  const setCookie = headers.get('set-cookie')
  if (setCookie === null) throw new Error('fixture: session manager wrote no cookie')
  return new Request('http://x/api/tasks', {
    headers: { cookie: setCookie.split(';')[0] },
  })
}

describe('Authenticated(sessions) (#574)', () => {
  const sessions = createSessionManagerWeb<{ userId: string }>({ secret: SECRET })

  it('admits a caller carrying a valid session', async () => {
    // The assertion the hand-rolled version did not have, and whose absence let a
    // deny-everyone guard ship as if it worked.
    const guard = new (Authenticated(sessions))()
    const request = await withCookie(sessions, { userId: 'u-1' })

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
  })

  it('refuses a caller with no session', async () => {
    const guard = new (Authenticated(sessions))()
    const request = new Request('http://x/api/tasks')

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(false)
  })

  it('refuses a session cookie it cannot decrypt', async () => {
    // A cookie signed with another secret is not a session, and must not be read as one.
    const other = createSessionManagerWeb<{ userId: string }>({
      secret: 'ca9d2e3cdc2db2e3f59cbaa6f4157e8bdf99b028b4da3550c4b92fed1bc34552',
    })
    const guard = new (Authenticated(sessions))()
    const request = await withCookie(other, { userId: 'u-1' })

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(false)
  })

  it('reads the request, never the context — the mistake it exists to remove', async () => {
    // Stated as an executable fact rather than a comment: the shape this guard is handed carries
    // no subject, so the wrong implementation is not merely discouraged, it now throws.
    const request = await withCookie(sessions, { userId: 'u-1' })
    expect(() => subjectFromContext(contextFor(request))).toThrow(TypeError)

    // And the right one still admits the same caller.
    const guard = new (Authenticated(sessions))()
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
  })

  it('takes any session reader, so an app is not forced to use one manager', async () => {
    // Structural by design: the guard asks for `getSession` and nothing else.
    const guard = new (Authenticated({ getSession: () => Promise.resolve({ userId: 'u-2' }) }))()

    await expect(guard.canActivate(contextFor(new Request('http://x/')))).resolves.toBe(true)
  })
})

describe('a broken session layer is a fault, not a denial (#574)', () => {
  it('propagates an error from getSession instead of answering false', async () => {
    // Denying is the safe direction, which is exactly why swallowing here would go unnoticed: an
    // unreachable session store or a broken secret would be reported as "not signed in" forever.
    const guard = new (Authenticated({
      getSession: () => Promise.reject(new Error('session store unreachable')),
    }))()

    await expect(guard.canActivate(contextFor(new Request('http://x/')))).rejects.toThrow(
      'session store unreachable',
    )
  })
})
