/**
 * M2 (theokit-ai-first) — wiring tests for the two HTTP callers of `mountAgent`:
 * the prod handler `tryServeAgent` (start/handlers.ts) and the dev middleware factory
 * `createAgentMiddleware`. The shared mount logic is covered by mount-agent.test.ts + the
 * built-server E2E; these assert the routing DECISIONS unique to each caller (prefix
 * ownership, agent-not-found fall-through, method enforcement) without the SDK.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { tryServeAgent } from '../../packages/theo/src/cli/commands/start/handlers.js'
import { createAgentMiddleware } from '../../packages/theo/src/vite-plugin/agent-middleware.js'
import type { AgentNode } from '../../packages/theo/src/server/scan/agent-scan.js'

/** Minimal capturing ServerResponse double. */
function fakeRes(): ServerResponse & { _status: number; _ended: boolean } {
  const res = {
    _status: 0,
    _ended: false,
    statusCode: 0,
    setHeader() {},
    writeHead(status: number) {
      this._status = status
      this.statusCode = status
      return this
    },
    // A response with a body reaches `write` — the aux routes answer with JSON and SSE frames.
    write() {
      return true
    },
    end() {
      this._ended = true
      return this
    },
  }
  return res as unknown as ServerResponse & { _status: number; _ended: boolean }
}

function ctx(url: string, method: string, agents: AgentNode[]) {
  return {
    // A real Readable: `incomingMessageToWebRequest` needs one. The plain object this used to be
    // threw inside the handler's try, so these tests were silently exercising the 500 path.
    req: Object.assign(Readable.from([]), {
      method,
      url,
      headers: {},
    }) as unknown as IncomingMessage,
    res: fakeRes(),
    url,
    requestId: 'r1',
    startTime: 0,
    cachedAgents: agents,
    csrfMode: 'strict' as const,
    rateLimiter: null,
    // Unused by the branch paths under test:
    clientDir: '',
    custom404Html: null,
    cachedRoutes: [],
    cachedActions: [],
    loadModule: async () => ({}),
    serverDir: '',
    pluginRunner: undefined,
    transformer: undefined,
    disallowed: undefined,
  }
}

/** A plugin runner double that records which hooks ran. */
function fakeRunner(seen: string[]) {
  return {
    applyDecorations() {},
    async runOnRequest() {
      seen.push('onRequest')

      return { shortCircuited: false }
    },
    async runPreHandler() {
      seen.push('preHandler')

      return { shortCircuited: false }
    },
    async runOnResponse() {
      seen.push('onResponse')
    },
    async runOnError() {
      seen.push('onError')
    },
  }
}

const ECHO: AgentNode = {
  filePath: '/p/agents/echo.ts',
  agentPath: '/api/agents/echo',
  name: 'echo',
}

describe('tryServeAgent runs the plugin lifecycle (theokit#324)', () => {
  it('runs onRequest and onResponse around an agent turn', async () => {
    // An app embedding TheoKit had NO supported place to observe an agent turn: plugin hooks fired
    // for every other route and not for this one, because this branch never consulted the runner.
    // Reported with a repro at usetheokit/theokit#324.
    const seen: string[] = []
    const c = ctx('/api/agents/echo', 'POST', [ECHO])
    c.pluginRunner = fakeRunner(seen) as unknown as typeof c.pluginRunner

    await tryServeAgent(c as never)

    expect(seen).toContain('onRequest')
    expect(seen).toContain('onResponse')
  })

  it('lets onRequest short-circuit before the agent is mounted', async () => {
    // The same guarantee `executeRoute` gives: a hook that answers the request stops the pipeline.
    let mounted = false
    const c = ctx('/api/agents/echo', 'POST', [ECHO])
    c.loadModule = async () => {
      mounted = true

      return {}
    }
    c.pluginRunner = {
      applyDecorations() {},
      async runOnRequest() {
        return { shortCircuited: true }
      },
      async runPreHandler() {
        return { shortCircuited: false }
      },
      async runOnResponse() {},
      async runOnError() {},
    } as unknown as typeof c.pluginRunner

    await tryServeAgent(c as never)

    expect(mounted).toBe(false)
  })

  it('still serves the agent when no plugin runner is configured', async () => {
    // The overwhelmingly common case: no plugins at all. The lifecycle must be optional, not a
    // dependency, or every app without plugins breaks.
    const c = ctx('/api/agents/echo', 'POST', [ECHO])

    expect(await tryServeAgent(c as never)).toBe(true)
  })
})

describe('tryServeAgent (M2 prod handler)', () => {
  it('test_returns_false_for_non_agent_path', async () => {
    const c = ctx('/api/users', 'POST', [ECHO])

    expect(await tryServeAgent(c as any)).toBe(false)
  })

  it('test_returns_false_when_agent_not_found_falls_through', async () => {
    const c = ctx('/api/agents/unknown', 'POST', [ECHO])

    expect(await tryServeAgent(c as any)).toBe(false)
    expect(c.res._status).toBe(0) // did not respond — leaves the 404 to the api branch
  })

  it('test_returns_405_for_non_post_method_on_known_agent', async () => {
    const c = ctx('/api/agents/echo', 'GET', [ECHO])

    expect(await tryServeAgent(c as any)).toBe(true)
    expect(c.res._status).toBe(405)
  })
})

describe('createAgentMiddleware (M2 dev factory)', () => {
  it('test_factory_wires_without_throwing', () => {
    const fakeVite = { config: { server: {} } } as never
    expect(() => createAgentMiddleware(fakeVite, '/tmp/project')).not.toThrow()
    expect(() => createAgentMiddleware(fakeVite, '/tmp/project', 'off')).not.toThrow()
  })

  it('test_middleware_calls_next_for_non_agent_path', () => {
    const fakeVite = { config: { server: {} } } as never
    const mw = createAgentMiddleware(fakeVite, '/tmp/project')
    let nextCalled = false
    mw({ url: '/api/users', method: 'POST', headers: {} } as IncomingMessage, fakeRes(), () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
  })
})

/**
 * The dev middleware used to carry its own list of which aux paths to dispatch — the approvals
 * listing and MCP — while the dispatcher's table held six. So `theokit dev` 404'd the durable
 * run-stream reconnect and both thread routes that `theokit start` served, and nothing compared the
 * two lists (usetheokit/theokit#405). It now asks the table.
 *
 * The run-stream route is the one exercised here because it answers immediately for an unknown
 * runId; the thread stream would hold an SSE connection open for its idle window.
 */
describe('theokit dev serves the aux routes theokit start serves (usetheokit/theokit#405)', () => {
  /** A real `agents/` directory, so the dev scanner finds an agent the way it does in a project. */
  const devRoot = mkdtempSync(join(tmpdir(), 'theokit-dev-aux-'))
  mkdirSync(join(devRoot, 'agents'))
  writeFileSync(join(devRoot, 'agents', 'chat.ts'), "export const policy = 'public'\n")

  /** Drive the middleware and settle when it either answered or handed the url on. */
  async function drive(url: string, pluginRunner?: unknown) {
    const fakeVite = { config: { server: {} }, ssrLoadModule: async () => ({}) } as never
    const mw = createAgentMiddleware(fakeVite, devRoot, 'off', 'agents', {
      pluginRunner: pluginRunner as never,
    })
    const res = fakeRes()
    let nextCalled = false
    mw({ url, method: 'GET', headers: { host: 'localhost' } } as IncomingMessage, res, () => {
      nextCalled = true
    })
    for (let i = 0; i < 200 && !nextCalled && !res._ended && res._status === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return { res, nextCalled }
  }

  it('test_the_durable_run_stream_route_is_dispatched_in_dev', async () => {
    const { res, nextCalled } = await drive('/api/agents/chat/runs/run-unknown/stream')

    // Before: `next()`, and the api-middleware 404'd a route the framework serves in production.
    expect(nextCalled).toBe(false)
    expect(res._status).toBe(404) // the dispatcher's own answer for an unknown runId
  })

  it('test_an_aux_route_runs_the_plugin_lifecycle_in_dev', async () => {
    const seen: string[] = []

    await drive('/api/agents/chat/runs/run-unknown/stream', fakeRunner(seen))

    expect(seen).toContain('onRequest')
    expect(seen).toContain('onResponse')
  })
})
