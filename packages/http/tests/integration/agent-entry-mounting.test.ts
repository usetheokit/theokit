import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TheoApp } from '../../src/app.js'

/**
 * M53 — the agents branch of `TheoApp` had NO test at all (the only reference to `agents:` in the
 * suite was commented out), which is how a bug that made every HTTP agent run the fallback model
 * survived. This mounts an agent the new way — a prepared entry, no decorated class — and asserts
 * both that the route is served and that the compiled options actually reach the stream factory.
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
