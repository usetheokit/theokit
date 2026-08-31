import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

// `dist`, not `src`: this project applies decorators through esbuild, and the built package is what
// a consumer imports. `tests/integration/controller-serve.test.ts` reaches for it the same way.
import {
  Controller,
  createDecoratorHandler,
  Get,
  UseGuards,
} from '../../packages/http/dist/index.js'
import { Authenticated } from '../../packages/theo/src/server/auth/authenticated-guard.js'
import { createSessionManagerWeb } from '../../packages/theo/src/server/auth/session.js'

/**
 * `Authenticated(sessions)` reaches the dispatcher (usetheokit/theokit#574).
 *
 * The unit suite beside the guard drives `canActivate` directly, which proves the DECISION and not
 * that `@UseGuards(Authenticated(sessions))` arrives at it. A guard that is correct and unwired is
 * the same outcome as no guard, and this repository has paid for that shape before: three modules
 * shipped with passing tests and no importable door, because a green suite proves code WORKS and
 * never that it is REACHABLE.
 *
 * It lives here rather than beside the guard because `packages/theo/tsconfig.json` does not enable
 * `experimentalDecorators`, so `@Controller` there compiles to a standard decorator the walker does
 * not read — measured: `walkControllerMetadata` returns `[]`. The root project does enable it.
 */

/** 32+ chars, which `createSessionManagerWeb` enforces. A fixture, not a credential. */
const SECRET = 'integration-secret-value-0123456789abcdef'

const sessions = createSessionManagerWeb<{ userId: string }>({ secret: SECRET })

@Controller('api/tasks')
@UseGuards(Authenticated(sessions))
class TasksController {
  @Get()
  list(): { ok: boolean } {
    return { ok: true }
  }
}

const handle = createDecoratorHandler([TasksController])

const signedIn = async (): Promise<Headers> => {
  const headers = new Headers()
  await sessions.createSession(headers, { userId: 'u-1' })
  const setCookie = headers.get('set-cookie')
  if (setCookie === null) throw new Error('fixture: session manager wrote no cookie')
  return new Headers({ cookie: setCookie.split(';')[0] })
}

describe('Authenticated wired through the dispatcher the framework reuses (#574)', () => {
  it('serves a caller carrying a session', async () => {
    const res = await handle(new Request('http://x/api/tasks', { headers: await signedIn() }))

    expect(res?.status).toBe(200)
    expect(await res!.json()).toEqual({ ok: true })
  })

  it('answers 403 to a caller with none', async () => {
    expect((await handle(new Request('http://x/api/tasks')))?.status).toBe(403)
  })

  it('counts as an access declaration, so the refusal comes from the guard', async () => {
    // #576 refuses an undeclared route with the same status code. Reading one as the other would
    // let a guard that never ran pass the assertion above.
    const res = await handle(new Request('http://x/api/tasks'))
    const body = (await res!.json()) as { error?: { message?: string } }

    expect(body.error?.message).not.toMatch(/declares no access decision/u)
  })
})
