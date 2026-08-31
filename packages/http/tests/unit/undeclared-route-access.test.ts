/**
 * A route that declared nothing is distinguishable from one declared open (usetheokit/theokit#576).
 *
 * The reported defect is one ambiguity with three consequences. `guards: []` meant both *"open on
 * purpose"* and *"nobody said"*, so the dispatcher took the permissive reading:
 *
 * 1. The controller dispatcher runs a zero-length guard loop and serves. Safe only while a separate
 *    build gate (#514) refuses undeclared controller routes — which makes least privilege a
 *    property of the pipeline, not of the system, and `@theokit/http` ships on its own.
 * 2. Agent routes make the fall-through explicit (`if (route.guards.length > 0)`) and are matched
 *    FIRST — before static, controllers and file routes.
 * 3. Nothing gates agent routes for absence at all. They are auto-wired, so no file exists for a
 *    reviewer to read, and a capability-authored agent has no class, so it takes no `@UseGuards`.
 *
 * These tests cover the removal of the ambiguity and the deny/warn policy built on it. Least
 * privilege IS the default now: `'deny'` refuses an undeclared route and `'warn'` is the migration
 * escape an app opts into. The sibling file `undeclared-route-dispatchers.test.ts` asserts the same
 * property through the other two dispatchers, which is where the gate had no reach at all.
 */
import { describe, expect, it, vi } from 'vitest'

import { TheoApp } from '../../src/app.js'
import { Controller, Get, Public, UseGuards } from '../../src/index.js'
import { classifyAccess, undeclaredRouteWarning } from '../../src/route-access.js'

/**
 * Drive one request through a mounted app.
 *
 * `handleRequest` is private and the only public entry is `listen`, which binds a port. Reaching
 * the dispatcher directly keeps these tests deterministic and free of a real socket; the cast is
 * the honest cost, and it is confined to this one helper rather than sprinkled through the file.
 */
const drive = (app: TheoApp, request: Request): Promise<Response> =>
  (app as unknown as { handleRequest(r: Request): Promise<Response> }).handleRequest(request)

/** A guard that admits everyone — enough to BE a declaration, which is all these assert. */
class AlwaysAllows {
  canActivate(): boolean {
    return true
  }
}

describe('absence is representable (#576)', () => {
  it('tells "nobody said" from "open on purpose"', () => {
    // The whole issue in two lines. Before this, both were `guards: []`.
    expect(classifyAccess({ guards: [] })).toBe('undeclared')
    expect(classifyAccess({ access: 'public', guards: [] })).toBe('public')
  })

  it('treats a missing guards array as undeclared, not as guarded', () => {
    // `entry.guards ?? []` is where an agent route's absence used to become an empty array and
    // then a served request.
    expect(classifyAccess({})).toBe('undeclared')
  })

  it('reads a non-empty guards array as a declaration', () => {
    // Attaching a guard IS saying who decides. Requiring `access: 'guarded'` on top of it would
    // make every app that already guards its routes re-declare what it plainly declared.
    expect(classifyAccess({ guards: [AlwaysAllows] })).toBe('guarded')
  })

  it('lets an explicit decision win over the guards it carries', () => {
    // A route can be public and still run guards for something other than access (rate limiting,
    // tracing). The explicit word is the author's, and it outranks the inference.
    expect(classifyAccess({ access: 'public', guards: [AlwaysAllows] })).toBe('public')
    expect(classifyAccess({ access: 'guarded', guards: [] })).toBe('guarded')
  })
})

describe('the warning is actionable (#576)', () => {
  it('names the route, the remedy, and why the request was served at all', () => {
    const said = undeclaredRouteWarning('agent', '/api/agents/assistant/chat')

    expect(said).toContain('/api/agents/assistant/chat')
    expect(said).toMatch(/access: 'public'/u)
    // Only reachable under an explicit opt-in now, and it must say so: a warning that reads like
    // the default leaves the operator unable to tell which setting produced it.
    expect(said).toMatch(/undeclaredRoutes: 'warn'/u)
    expect(
      said,
      'a warning that does not say what happens without it is advice, not a warning',
    ).toMatch(/403/u)
  })

  it('names the remedy that exists on the surface being warned about', () => {
    // `access: 'public'` is how an agent entry says it; `@Public()` is how a controller says it.
    // Telling a controller author to set an option they do not have is worse than saying nothing.
    expect(undeclaredRouteWarning('controller', '/tasks')).toMatch(/@Public\(\)/u)
    expect(undeclaredRouteWarning('controller', '/tasks')).not.toMatch(/access: 'public'/u)
  })
})

/**
 * The wiring, exercised through a real `TheoApp` (#576).
 *
 * The classifier above is a pure function, and a pure function nothing calls protects nobody. These
 * drive the mounted app: an agent entry that declares nothing must warn at boot, and must be
 * refused at dispatch when the app asked for that.
 */
describe('the app applies the decision it classified (#576)', () => {
  const compiled = { model: 'anthropic/claude-sonnet-5', tools: [], agents: {}, stream: true }

  /** The smallest agent runtime that produces one route, so the mount path is real. */
  const runtime = {
    generateAgentRoutes: () => [
      {
        method: 'POST',
        // The full mounted path, which is what the real runtime returns — `app.ts` builds the
        // match pattern from this alone. Writing '/chat' here made every dispatch test 404 and is
        // what caught the prefix being doubled in the warning.
        path: '/api/agents/assistant/chat',
        handler: () => Promise.resolve(new Response('served', { status: 200 })),
      },
    ],
    createSdkAgentStream: () => () =>
      (async function* () {
        // No events: this test never runs the agent, only reaches (or fails to reach) its handler.
      })(),
  }

  const entry = (extra: Record<string, unknown> = {}) => ({
    name: 'assistant',
    route: '/api/agents/assistant',
    compiled,
    ...extra,
  })

  it("warns once at boot under 'warn', naming the mounted path", async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await TheoApp.create({
      controllers: [],
      agents: [entry()],
      agentRuntime: runtime as never,
      undeclaredRoutes: 'warn',
    })
    const said = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    spy.mockRestore()

    expect(said).toContain('/api/agents/assistant/chat')
    expect(said).toMatch(/declares no access decision/u)
  })

  it('names the route at boot under the DEFAULT policy too, as an error', async () => {
    // An agent route is auto-wired: the app never wrote a file for a reviewer to read, and there is
    // no build gate over it the way #514 covers controllers. Without a line at boot the operator's
    // first signal is a 403 on a route they did not author.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await TheoApp.create({
      controllers: [],
      agents: [entry()],
      agentRuntime: runtime as never,
    })
    const said = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    spy.mockRestore()

    expect(said).toContain('/api/agents/assistant/chat')
    expect(said).toMatch(/declares no access decision/u)
    // It must say what HAPPENS, not merely that something is wrong: under 'deny' the route is
    // already refused, and a line worded as a warning would describe the other policy.
    expect(said).toMatch(/refused/u)
  })

  it('says nothing when the entry declared one', async () => {
    // Both shapes of declaration, because warning on a guarded route is how a real warning gets
    // muted by the people it is meant for.
    for (const declared of [{ access: 'public' as const }, { guards: [AlwaysAllows] }]) {
      // Both channels, because the boot notice moved to `console.error` under the default policy
      // and a test watching one of them would call the other silent.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      await TheoApp.create({
        controllers: [],
        agents: [entry(declared)],
        agentRuntime: runtime as never,
      })
      const said = [...warn.mock.calls, ...error.mock.calls].map((c) => c.join(' ')).join('\n')
      warn.mockRestore()
      error.mockRestore()

      expect(said).not.toMatch(/declares no access decision/u)
    }
  })

  it("refuses an undeclared agent route with 403 under undeclaredRoutes: 'deny'", async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = await TheoApp.create({
      controllers: [],
      agents: [entry()],
      agentRuntime: runtime as never,
      undeclaredRoutes: 'deny',
    })
    spy.mockRestore()

    const res = await drive(
      app,
      new Request('http://x/api/agents/assistant/chat', { method: 'POST' }),
    )
    expect(res.status).toBe(403)
  })

  it("serves a declared-public agent route even under 'deny'", async () => {
    // The load-bearing negative: 'deny' must refuse the UNDECLARED, not everything. Without this,
    // "always 403" passes the test above and breaks every app that opted in.
    const app = await TheoApp.create({
      controllers: [],
      agents: [entry({ access: 'public' })],
      agentRuntime: runtime as never,
      undeclaredRoutes: 'deny',
    })

    const res = await drive(
      app,
      new Request('http://x/api/agents/assistant/chat', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('served')
  })

  it('refuses an undeclared agent route under the DEFAULT policy', async () => {
    // The whole point of the major. Agent routes are auto-wired, matched before everything else,
    // and the app never wrote a file for a reviewer to read — so an opt-in safe default protected
    // exactly nobody among the population this issue is about.
    const app = await TheoApp.create({
      controllers: [],
      agents: [entry()],
      agentRuntime: runtime as never,
    })

    const res = await drive(
      app,
      new Request('http://x/api/agents/assistant/chat', { method: 'POST' }),
    )
    expect(res.status).toBe(403)
  })

  it("serves an undeclared agent route under undeclaredRoutes: 'warn'", async () => {
    // The migration escape, asserted rather than described: an app whose agent endpoints are open
    // today has one line to write while it declares them, and it is not a downgrade.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = await TheoApp.create({
      controllers: [],
      agents: [entry()],
      agentRuntime: runtime as never,
      undeclaredRoutes: 'warn',
    })
    spy.mockRestore()

    const res = await drive(
      app,
      new Request('http://x/api/agents/assistant/chat', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
  })
})

/**
 * The controller half of the same wiring (#576).
 *
 * Split out because the agent tests above passed while this path had no test at all: a full run of
 * the monorepo suite emitted ZERO undeclared warnings, which is what showed the gap. A caller
 * nothing exercises is a caller nobody has checked.
 */
describe('the app applies the decision to controller routes too (#576)', () => {
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

  @Controller('silent')
  class DeclaredNothing {
    @Get()
    read(): { ok: boolean } {
      return { ok: true }
    }
  }

  const controllers = [DeclaredOpen, DeclaredGuarded, DeclaredNothing]

  it("warns once per undeclared controller route under 'warn', and only for that one", async () => {
    const app = await TheoApp.create({ controllers, undeclaredRoutes: 'warn' })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await drive(app, new Request('http://x/silent'))
    await drive(app, new Request('http://x/silent'))
    await drive(app, new Request('http://x/open'))
    await drive(app, new Request('http://x/guarded'))

    const said = spy.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('access decision'))
    spy.mockRestore()

    // Once, despite two requests: a warning repeated per call is one that gets filtered out.
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('/silent')
    expect(said[0]).toMatch(/@Public\(\)/u)
  })

  it("refuses only the undeclared route under 'deny'", async () => {
    const app = await TheoApp.create({ controllers, undeclaredRoutes: 'deny' })

    expect((await drive(app, new Request('http://x/silent'))).status).toBe(403)
    // Both declarations must survive 'deny'. Without these two, "always 403" passes the assertion
    // above and breaks every route in an app that opted in.
    expect((await drive(app, new Request('http://x/open'))).status).toBe(200)
    expect((await drive(app, new Request('http://x/guarded'))).status).toBe(200)
  })

  it('refuses the undeclared controller route under the DEFAULT policy', async () => {
    const app = await TheoApp.create({ controllers })

    expect((await drive(app, new Request('http://x/silent'))).status).toBe(403)
    // And the declared ones are untouched by the flip — the assertion that keeps "deny everything"
    // from passing as a fix.
    expect((await drive(app, new Request('http://x/open'))).status).toBe(200)
    expect((await drive(app, new Request('http://x/guarded'))).status).toBe(200)
  })

  it('reads @Public() from the CLASS, not only the method', async () => {
    // `@Public()` is a MethodDecorator & ClassDecorator, and the build gate honours both. A
    // dispatcher that only read the method would deny a controller declared open at class level.
    @Public()
    @Controller('all-open')
    class OpenController {
      @Get()
      read(): { ok: boolean } {
        return { ok: true }
      }
    }

    const app = await TheoApp.create({ controllers: [OpenController], undeclaredRoutes: 'deny' })
    expect((await drive(app, new Request('http://x/all-open'))).status).toBe(200)
  })
})
