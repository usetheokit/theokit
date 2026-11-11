import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { MattermostAdapter } from '@theokit/gateway-mattermost'
import { describe, expect, it } from 'vitest'

// Regression for #1433: gateway-mattermost 0.2.1 failed with "mod.Client4 is not a constructor"
// through its ESM entry, so the runner never sent a request to the server.
describe('Mattermost adapter connect', () => {
  it('reaches the configured server through the ESM entry', async () => {
    let requests = 0
    const server = createServer((_req, res) => {
      requests += 1
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 'bot1', username: 'bot' }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const adapter = new MattermostAdapter({
      baseUrl: `http://127.0.0.1:${port}`,
      accessToken: 'tok',
    })
    try {
      await adapter.connect()
      expect(requests).toBeGreaterThan(0)
    } finally {
      await adapter.disconnect().catch(() => undefined)
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
