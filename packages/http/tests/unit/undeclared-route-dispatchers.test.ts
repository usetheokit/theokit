import 'reflect-metadata'

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createDecoratorHandler } from '../../src/bridge/create-server.js'
import { walkControllerMetadata } from '../../src/bridge/walk-metadata.js'
import { Controller, Get, Public, UseGuards } from '../../src/index.js'
import { httpDecoratorsPlugin } from '../../src/theokit-plugin.js'

/**
 * One classification, three dispatchers, one answer (usetheokit/theokit#576).
 *
 * #576 shipped `undeclaredRoutes` on `TheoApp` and stopped there. `@theokit/http` has THREE
 * controller dispatchers over the same `WalkResult`, and the framework's own controller dispatch
 * (`theokit dev`, `theokit start`) reuses the one that had no check at all:
 *
 *   packages/theo/src/server/http/controller-dispatch.ts
 *     → createDecoratorHandler   (bridge/create-server.ts)
 *
 * So an app could set the option, pass the build gate, and still serve an undeclared route — and in
 * `theokit dev`, which never runs the build gate, nothing looked at the question at all. A gate that
 * holds in one of three dispatchers is the lint the issue's title names, one layer down.
 *
 * These tests exist because the fix is only real if every dispatcher answers identically. They are
 * written per-dispatcher on purpose: a single test through one of them would have passed before
 * this change.
 */

// Bun lacks emitDecoratorMetadata (same as esbuild); decorator tests need SWC via vitest.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

/** Admits everyone — enough to BE a declaration, which is what these assert. */
class AlwaysAllows {
  canActivate(): boolean {
    return true
  }
}

@Controller('silent')
class DeclaredNothing {
  @Get()
  read(): { ok: boolean } {
    return { ok: true }
  }
}

@Controller('open')
class DeclaredOpen {
  @Get()
  @Public()
  read(): { ok: boolean } {
    return { ok: true }
  }
}

@Controller('guarded')
@UseGuards(AlwaysAllows)
class DeclaredGuarded {
  @Get()
  read(): { ok: boolean } {
    return { ok: true }
  }
}

@Controller('empty-guards')
@UseGuards()
class DeclaredWithNoGuards {
  @Get()
  read(): { ok: boolean } {
    return { ok: true }
  }
}

const ALL = [DeclaredNothing, DeclaredOpen, DeclaredGuarded, DeclaredWithNoGuards]

describe.skipIf(!isVitest)('the walk decides access once, for every dispatcher (#576)', () => {
  const accessOf = (Ctor: Function): string => walkControllerMetadata(Ctor)[0].access

  it('classifies each declaration from the class alone', () => {
    expect(accessOf(DeclaredNothing)).toBe('undeclared')
    expect(accessOf(DeclaredOpen)).toBe('public')
    expect(accessOf(DeclaredGuarded)).toBe('guarded')
  })

  it('reads @UseGuards() with no arguments as a declaration of nothing', () => {
    // It looks guarded in the file and runs a zero-length loop at dispatch. The build gate used to
    // accept it on presence alone, so the two disagreed — the build passed, the request was served
    // unguarded, and both sides believed the other was checking.
    expect(accessOf(DeclaredWithNoGuards)).toBe('undeclared')
  })
})

describe.skipIf(!isVitest)('createDecoratorHandler refuses what nobody declared (#576)', () => {
  it('denies by default — this is the dispatcher the framework reuses', async () => {
    const handle = createDecoratorHandler(ALL)

    const res = await handle(new Request('http://x/silent'))
    expect(res?.status).toBe(403)
    // The 403 has to name the route AND both remedies, or an operator meeting it in `theokit dev`
    // cannot tell it from a guard refusing a caller.
    const body = (await res!.json()) as { error?: { message?: string } }
    expect(body.error?.message).toContain('/silent')
    expect(body.error?.message).toMatch(/@Public\(\)/u)
  })

  it('denies a route whose only declaration is an empty @UseGuards()', async () => {
    const handle = createDecoratorHandler(ALL)
    expect((await handle(new Request('http://x/empty-guards')))?.status).toBe(403)
  })

  it('serves both declarations under the same default', async () => {
    // The load-bearing negative: "deny" must refuse the UNDECLARED, not everything. Without this,
    // an always-403 dispatcher passes the assertions above and breaks every route in every app.
    const handle = createDecoratorHandler(ALL)

    expect((await handle(new Request('http://x/open')))?.status).toBe(200)
    expect((await handle(new Request('http://x/guarded')))?.status).toBe(200)
  })

  it("serves an undeclared route under undeclaredRoutes: 'warn', once per route", async () => {
    const handle = createDecoratorHandler({ controllers: ALL, undeclaredRoutes: 'warn' })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect((await handle(new Request('http://x/silent')))?.status).toBe(200)
    expect((await handle(new Request('http://x/silent')))?.status).toBe(200)

    const said = spy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('access decision'))
    spy.mockRestore()

    // Once, despite two requests: a line repeated per call is one that gets filtered out.
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('/silent')
  })

  it('keeps a route missing entirely as a miss, not a refusal', async () => {
    // `null` means "not mine" and the host owns the 404. Answering 403 here would make every
    // unmatched path in a host application look like an access failure.
    const handle = createDecoratorHandler(ALL)
    expect(await handle(new Request('http://x/nothing-here'))).toBeNull()
  })
})

describe.skipIf(!isVitest)('httpDecoratorsPlugin refuses what nobody declared (#576)', () => {
  /** Drive the plugin the way TheoKit's plugin runner does: one `onRequest` hook over node http. */
  const serverFor = (undeclaredRoutes?: 'warn' | 'deny'): Server => {
    const plugin = httpDecoratorsPlugin({
      controllers: ALL,
      ...(undeclaredRoutes === undefined ? {} : { undeclaredRoutes }),
    })
    let hook: ((ctx: Record<string, unknown>) => Promise<void>) | undefined
    plugin.register({
      addHook: (_name, fn) => {
        hook = fn
      },
    })

    return createServer((request, response) => {
      void (async () => {
        await hook?.({ request, response })
        if (!response.headersSent) {
          response.statusCode = 404
          response.end('miss')
        }
      })()
    })
  }

  let denying: Server
  let warning: Server
  let denyPort: number
  let warnPort: number

  beforeAll(async () => {
    denying = serverFor()
    warning = serverFor('warn')
    await Promise.all(
      [denying, warning].map(
        (s) => new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve)),
      ),
    )
    denyPort = (denying.address() as AddressInfo).port
    warnPort = (warning.address() as AddressInfo).port
  })

  afterAll(async () => {
    await Promise.all([denying, warning].map((s) => new Promise((resolve) => s.close(resolve))))
  })

  it('denies by default', async () => {
    const res = await fetch(`http://127.0.0.1:${denyPort}/silent`)
    expect(res.status).toBe(403)
    expect(await res.text()).toMatch(/declares no access decision/u)
  })

  it('serves both declarations under the same default', async () => {
    expect((await fetch(`http://127.0.0.1:${denyPort}/open`)).status).toBe(200)
    expect((await fetch(`http://127.0.0.1:${denyPort}/guarded`)).status).toBe(200)
  })

  it("serves an undeclared route under undeclaredRoutes: 'warn'", async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await fetch(`http://127.0.0.1:${warnPort}/silent`)
    spy.mockRestore()

    expect(res.status).toBe(200)
  })

  it('still falls through on a path it does not own', async () => {
    const res = await fetch(`http://127.0.0.1:${denyPort}/nothing-here`)
    expect(res.status).toBe(404)
  })
})
