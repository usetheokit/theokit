import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'

import {
  callProcedure,
  ProcedureAccessError,
} from '../../packages/theo/src/server/http/in-process-caller.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'
import { executeRoute } from '../../packages/theo/src/server/http/execute.js'
import { PluginRunner } from '../../packages/theo/src/server/plugins/plugin-runner.js'
import { requireOwner } from '../../packages/theo/src/core/contracts/route-policy.js'
import type { RoutePolicyInput } from '../../packages/theo/src/core/contracts/route-policy.js'
import type { RouteConfig } from '../../packages/theo/src/core/contracts/route-config.js'

/**
 * ADR 0001 names this test as its own verification:
 *
 *   "A test that reaches the same route over HTTP and through `callProcedure`
 *    and asserts an identical access decision for the same subject. That test IS
 *    the ADR: without it, the claim 'not a second implementation' is unenforced."
 *
 * The measured state it responds to: `callProcedure` ran no middleware and no
 * auth, deliberately and on tRPC's precedent, while the HTTP path enforced
 * whatever middleware it was given. So a route with access rules had them over
 * HTTP and had none in-process - and in-process is the path the TUI and Tauri
 * targets are built on.
 *
 * What is asserted is the DECISION, not the shape of the answer. A denial is a
 * 403 envelope on HTTP and a thrown error off-web, because status codes do not
 * exist off-web; that difference is transport expressing one decision, which is
 * exactly the split the ADR chose. A test that demanded identical SHAPES would
 * be asserting that the transport leaked.
 */

interface Ctx {
  subject: { id: string } | null
}

const OWNER = 'user-owner'
const INTRUDER = 'user-intruder'

/** One route, one policy, reached two ways. */
function ownedRoute(): RouteConfig<z.ZodType, z.ZodType, z.ZodType> {
  return {
    body: z.object({ ownerId: z.string() }),
    policy: ({ subject, body }: RoutePolicyInput) =>
      requireOwner(subject, (body as { ownerId: string }).ownerId),
    handler: () => ({ ok: true }),
  } as unknown as RouteConfig<z.ZodType, z.ZodType, z.ZodType>
}

/**
 * Identity is established the way each transport establishes it - middleware on
 * HTTP, the ctx argument in-process - and that difference is the point rather
 * than a wart. What must not differ is the policy consulted afterwards.
 */
function seedSubject(subjectId: string | null) {
  return (_request: Request, context: Record<string, unknown>): void => {
    context.subject = subjectId === null ? null : { id: subjectId }
  }
}

async function decideOverHttp(subjectId: string | null, ownerId: string) {
  const response = await executeWebRequest(
    new Request('http://localhost/api/thing', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
      body: JSON.stringify({ ownerId }),
    }),
    { POST: ownedRoute() } as never,
    { middleware: [seedSubject(subjectId)] },
  )
  return { status: response.status, body: await response.clone().text() }
}

async function decideInProcess(subjectId: string | null, ownerId: string) {
  try {
    await callProcedure(ownedRoute(), { body: { ownerId } }, {
      subject: subjectId === null ? null : { id: subjectId },
    } satisfies Ctx)
    return { allowed: true, reason: undefined as string | undefined, typed: false }
  } catch (error) {
    // Asserted as the TYPED error, not as a message. `reason` is the decision the
    // policy returned; the message is presentation around it, and a test that
    // reads the message would keep passing if the type were replaced by a bare
    // `Error` — losing exactly what makes this catchable off-web (Rule 8).
    if (error instanceof ProcedureAccessError) {
      return { allowed: false, reason: error.reason, typed: true }
    }
    return { allowed: false, reason: String(error), typed: false }
  }
}

describe('one access decision, every transport (ADR 0001)', () => {
  it('test_the_owner_is_allowed_on_both_paths', async () => {
    const http = await decideOverHttp(OWNER, OWNER)
    const inProcess = await decideInProcess(OWNER, OWNER)

    expect(http.status).toBe(200)
    expect(inProcess.allowed).toBe(true)
  })

  it('test_an_authenticated_non_owner_is_refused_on_both_paths', async () => {
    // The case the in-process path used to wave through: authenticated, and not
    // entitled to this record.
    const http = await decideOverHttp(INTRUDER, OWNER)
    const inProcess = await decideInProcess(INTRUDER, OWNER)

    expect(http.status).toBe(403)
    expect(inProcess.allowed).toBe(false)
    expect(inProcess.typed).toBe(true)
    expect(inProcess.reason).toContain('does not own')
  })

  it('test_an_unauthenticated_caller_is_refused_on_both_paths', async () => {
    const http = await decideOverHttp(null, OWNER)
    const inProcess = await decideInProcess(null, OWNER)

    expect(http.status).toBe(403)
    expect(inProcess.allowed).toBe(false)
    expect(inProcess.reason).toContain('not authenticated')
  })

  it('test_the_denial_reason_is_the_same_sentence_on_both_paths', async () => {
    // Not cosmetic. Two transports reporting different reasons for one decision
    // means two policies were consulted, which is the thing this forbids.
    const http = await decideOverHttp(INTRUDER, OWNER)
    const inProcess = await decideInProcess(INTRUDER, OWNER)

    expect(inProcess.reason).toBeDefined()
    const reason = inProcess.reason ?? ''
    expect(http.body).toContain(reason)
  })

  it('test_a_route_that_declares_no_policy_behaves_as_it_did_before', async () => {
    // Absence is NOT reinterpreted as denial here. Flipping that at runtime would
    // break every existing route in every consumer at once; the ADR routes it
    // through a build-time gate and a migration instead.
    const open: RouteConfig<z.ZodType, z.ZodType, z.ZodType> = {
      handler: () => ({ ok: true }),
    } as unknown as RouteConfig<z.ZodType, z.ZodType, z.ZodType>

    const response = await executeWebRequest(
      new Request('http://localhost/api/thing', { method: 'GET' }),
      { GET: open } as never,
    )

    expect(response.status).toBe(200)
    await expect(callProcedure(open, {}, {})).resolves.toBeDefined()
  })
})

/**
 * The Node executor is the third path and the one production actually serves.
 * Covering only the two Web-shaped paths would have let the parity claim stand
 * while `theo start` enforced nothing - the looks-protected failure ADR 0001
 * rejects by name as alternative C.
 *
 * Note on `ctx`: the Node executor's handler context is NOT the object passed to
 * `executeRoute`. It is a separate run context built from middleware and plugin
 * decorations (`execute.ts` - `let ctx: Record<string, unknown> = {}`), which is
 * why identity is seeded here through a plugin hook rather than as a field on the
 * call. Discovering that cost a debugging round: seeding the executor argument
 * produced 'not authenticated' on every case, including the one that should pass.
 */
function mockReq(): IncomingMessage {
  return {
    method: 'GET',
    url: '/api/thing',
    headers: { host: 'localhost:3000' },
    on: vi.fn(),
  } as unknown as IncomingMessage
}

function mockRes(): ServerResponse & { _status: () => number; _body: () => string } {
  let body = ''
  let status = 200
  return {
    writeHead: vi.fn((s: number) => {
      status = s
    }),
    write: vi.fn(),
    end: vi.fn((b?: string) => {
      if (b) body = b
    }),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    headersSent: false,
    writableEnded: false,
    get statusCode() {
      return status
    },
    set statusCode(s: number) {
      status = s
    },
    _status: () => status,
    _body: () => body,
  } as unknown as ServerResponse & { _status: () => number; _body: () => string }
}

async function decideOverNode(subjectId: string | null, ownerId: string) {
  const res = mockRes()
  // Identity is established by this transport's own mechanism - a plugin hook
  // decorating the run context - exactly as HTTP-Web uses middleware and the
  // in-process caller uses its ctx argument. Three ways in, one policy after.
  const runner = new PluginRunner()
  await runner.register({
    name: 'seed-subject',
    register(app) {
      app.addHook('onRequest', (hookCtx) => {
        hookCtx.ctx.subject = subjectId === null ? null : { id: subjectId }
      })
    },
  })
  await executeRoute({
    pluginRunner: runner,
    route: {
      filePath: '/fake',
      routePath: '/api/thing',
      pattern: /^\/api\/thing$/,
      paramNames: [],
    },
    method: 'GET',
    params: {},
    req: mockReq(),
    res,
    loadModule: async () => ({
      GET: {
        policy: ({ subject }: RoutePolicyInput) => requireOwner(subject, ownerId),
        handler: () => ({ ok: true }),
      },
    }),
    requestId: 'req-policy',
  } as never)
  return { status: res._status(), body: res._body() }
}

describe('the Node executor consults the same policy (ADR 0001)', () => {
  it('test_the_owner_is_allowed', async () => {
    expect((await decideOverNode(OWNER, OWNER)).status).toBe(200)
  })

  it('test_an_authenticated_non_owner_is_refused', async () => {
    const result = await decideOverNode(INTRUDER, OWNER)

    expect(result.status).toBe(403)
    expect(result.body).toContain('does not own')
  })

  it('test_an_unauthenticated_caller_is_refused', async () => {
    const result = await decideOverNode(null, OWNER)

    expect(result.status).toBe(403)
    expect(result.body).toContain('not authenticated')
  })
})
