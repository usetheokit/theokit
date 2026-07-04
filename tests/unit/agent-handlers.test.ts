/**
 * M2 (theokit-ai-first) — wiring tests for the two HTTP callers of `mountAgent`:
 * the prod handler `tryServeAgent` (start/handlers.ts) and the dev middleware factory
 * `createAgentMiddleware`. The shared mount logic is covered by mount-agent.test.ts + the
 * built-server E2E; these assert the routing DECISIONS unique to each caller (prefix
 * ownership, agent-not-found fall-through, method enforcement) without the SDK.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

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
    end() {
      this._ended = true
      return this
    },
  }
  return res as unknown as ServerResponse & { _status: number; _ended: boolean }
}

function ctx(url: string, method: string, agents: AgentNode[]) {
  return {
    req: { method, url, headers: {} } as IncomingMessage,
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

const ECHO: AgentNode = {
  filePath: '/p/agents/echo.ts',
  agentPath: '/api/agents/echo',
  name: 'echo',
}

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
