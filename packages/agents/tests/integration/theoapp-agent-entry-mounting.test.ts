import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TheoApp } from '@theokit/http'

import { generateAgentRoutes } from '../../src/bridge/agent-route-generator.js'

/**
 * M53 — lives in `@theokit/agents` (not `@theokit/http`) on purpose: `agents` already depends on
 * `http`, so testing the bridge here keeps the dependency graph ACYCLIC. Declaring `agents` as a
 * devDep of `http` (the first attempt) created a build cycle that broke `pnpm -r build` ordering.
 *
 * The agents branch of `TheoApp` had NO test at all (the only reference to `agents:` in the
 * suite was commented out), which is how a bug that made every HTTP agent run the fallback model
 * survived. This mounts an agent the new way — a prepared entry, no decorated class — and asserts
 * both that the route is served and that the compiled options actually reach the stream factory.
 *
 * ## Why `agentRuntime` is passed explicitly now (B-M67-21)
 *
 * The paragraph above described the cycle and then routed AROUND it — moving the test was a
 * workaround, and the cause stayed in `TheoApp`, which reached into `@theokit/agents` with a
 * dynamic `import()`. That kept the agent package on `@theokit/http`'s manifest, which made pnpm
 * auto-install the **published** copy beside the workspace sibling: three published copies of our
 * own packages in the production tree, measured 2026-08-13.
 *
 * The direction is now inverted where it belongs. This layer hands the HTTP layer the runtime it
 * needs, which is exactly what `system-design-guardrails.md` § G1 always said — "agents depends on
 * http, not the reverse".
 */
describe('TheoApp — mounting a capability-authored agent entry', () => {
  let app: TheoApp
  let baseUrl: string
  const seen: { compiled: unknown; overrides: unknown }[] = []

  beforeAll(async () => {
    app = await TheoApp.create({
      controllers: [],
      agents: [
        {
          name: 'assistant',
          route: '/api/agents/assistant',
          compiled: { model: 'anthropic/claude-sonnet-5', tools: [], agents: {}, stream: true },
        },
      ],
      llmModel: 'openai/gpt-5.4',
      // The inversion, at the only call site that ever exercised this branch: the agent layer
      // supplies the route generator instead of the HTTP layer importing it.
      agentRuntime: { generateAgentRoutes },
      agentStreamFactory: (compiled, _tools, _apiKey, overrides) => {
        seen.push({ compiled, overrides })
        return () => ({
          async *[Symbol.asyncIterator]() {
            yield { type: 'text', text: 'ok' }
          },
        })
      },
    })
    const handle = app.getServerHandle()
    await new Promise<void>((resolve) => handle.listen(0, resolve))
    baseUrl = `http://127.0.0.1:${(handle.address() as { port: number }).port}`
  })

  afterAll(() => {
    app.getServerHandle().close()
  })

  it('hands the COMPILED options (not a metadata walk) to the stream factory', () => {
    expect(seen).toHaveLength(1)
    expect(seen[0].compiled).toMatchObject({ model: 'anthropic/claude-sonnet-5' })
  })

  it('forwards the app-level model as RuntimeOverrides, never as a bare string', () => {
    expect(seen[0].overrides).toEqual({ model: 'openai/gpt-5.4' })
  })

  it('serves the generated chat route under the declared mount point', async () => {
    const res = await fetch(`${baseUrl}/api/agents/assistant/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })
    expect(res.status).toBeLessThan(500)
  })
})
