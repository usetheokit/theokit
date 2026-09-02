import 'reflect-metadata'

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDecoratorHandler } from '../../src/bridge/create-server.js'
import { Controller, Get, UseGuards, TheoApp, TooManyRequestsException } from '../../src/index.js'
import { httpDecoratorsPlugin } from '../../src/theokit-plugin.js'

/**
 * A guard can refuse with a status and headers of its own (usetheokit/theokit#612).
 *
 * `CanActivate` returns a boolean, and every dispatcher turned `false` into `403 Forbidden
 * resource`. For "you are not signed in" that is right. For "you are allowed, later" it is wrong
 * twice over: the status says the caller may never come back, and the `Retry-After` /
 * `X-RateLimit-*` headers a limiter computed have nowhere to go — so a well-behaved client has
 * nothing to back off on and a broken one cannot tell the two refusals apart.
 *
 * Throwing an `HttpException` is the escape hatch that already existed for handlers, and the
 * dispatchers dropped its headers on the floor because `HttpException` had none to carry. Both
 * halves are fixed here: the exception carries headers, and every dispatcher answers the same way.
 *
 * Three dispatchers, one behaviour — the lesson of #576, which shipped a gate into one of the three
 * and left the one the framework itself reuses untouched.
 */

const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

const LIMIT_HEADERS = {
  'Retry-After': '42',
  'X-RateLimit-Limit': '20',
  'X-RateLimit-Remaining': '0',
}

/** The shape a rate-limit adapter needs: a refusal that carries its own status and headers. */
class RefusesWithBudget {
  canActivate(): boolean {
    throw new TooManyRequestsException('Rate limit exceeded', { headers: LIMIT_HEADERS })
  }
}

/** The shape every other guard has: a boolean. Must keep answering 403. */
class RefusesPlainly {
  canActivate(): boolean {
    return false
  }
}

/** A guard whose session store is down. NOT an access decision — must not be laundered into 403. */
class Breaks {
  canActivate(): boolean {
    throw new Error('session store unreachable')
  }
}

@Controller('limited')
@UseGuards(RefusesWithBudget)
class LimitedController {
  @Get()
  read(): { ok: boolean } {
    return { ok: true }
  }
}

@Controller('denied')
@UseGuards(RefusesPlainly)
class DeniedController {
  @Get()
  read(): { ok: boolean } {
    return { ok: true }
  }
}

@Controller('broken')
@UseGuards(Breaks)
class BrokenController {
  @Get()
  read(): { ok: boolean } {
    return { ok: true }
  }
}

const ALL = [LimitedController, DeniedController, BrokenController]

describe.skipIf(!isVitest)('createDecoratorHandler — guard refusal (#612)', () => {
  const handle = createDecoratorHandler(ALL)

  it('answers 429 with the headers the guard supplied', async () => {
    const res = await handle(new Request('http://x/limited'))

    expect(res?.status).toBe(429)
    expect(res?.headers.get('retry-after')).toBe('42')
    expect(res?.headers.get('x-ratelimit-limit')).toBe('20')
    expect(res?.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(await res!.json()).toMatchObject({
      error: { code: 'TOO_MANY_REQUESTS', statusCode: 429 },
    })
  })

  it('still answers 403 for a guard that returns false', async () => {
    const res = await handle(new Request('http://x/denied'))
    expect(res?.status).toBe(403)
  })

  it('does not turn a broken guard into an access decision', async () => {
    // Denying happens to be the safe direction, which is exactly why a swallowed fault would go
    // unnoticed — a broken session store would read as "this caller is not signed in".
    const res = await handle(new Request('http://x/broken'))
    expect(res?.status).toBe(500)
  })
})

describe.skipIf(!isVitest)('httpDecoratorsPlugin — guard refusal (#612)', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    const plugin = httpDecoratorsPlugin({ controllers: ALL })
    let hook: ((ctx: Record<string, unknown>) => Promise<void>) | undefined
    plugin.register({
      addHook: (_name, fn) => {
        hook = fn
      },
    })

    server = createServer((request, response) => {
      void (async () => {
        await hook?.({ request, response })
        if (!response.headersSent) {
          response.statusCode = 404
          response.end('miss')
        }
      })()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('answers 429 with the headers the guard supplied', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/limited`)

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0')
  })

  it('still answers 403 for a guard that returns false', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/denied`)).status).toBe(403)
  })
})

describe.skipIf(!isVitest)('TheoApp — guard refusal (#612)', () => {
  let app: TheoApp
  let port: number

  beforeAll(async () => {
    app = await TheoApp.create({ controllers: ALL })
    const server = app.getServerHandle()
    await new Promise<void>((resolve) => server.listen(0, resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => app.close())

  it('answers 429 with the headers the guard supplied', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/limited`)

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect(res.headers.get('x-ratelimit-limit')).toBe('20')
  })

  it('still answers 403 for a guard that returns false', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/denied`)).status).toBe(403)
  })

  it('does not turn a broken guard into an access decision', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/broken`)).status).toBe(500)
  })
})
