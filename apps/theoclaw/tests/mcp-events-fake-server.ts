import { createServer, request } from 'node:http'
import type { Server } from 'node:http'

import { signMcpEvent } from '@theokit/sdk/mcp-events'

/** A local MCP server that implements `events/subscribe` and can deliver a signed event to the callback it was given. */
export interface FakeMcpEventsServer {
  readonly url: string
  readonly methods: string[]
  /** Delivers `body` to the subscribed callback, signed with the subscription's secret (or `secret`); resolves the HTTP status. */
  emit(body: Record<string, unknown>, secret?: string): Promise<number>
  close(): Promise<void>
}

export async function fakeMcpEventsServer(): Promise<FakeMcpEventsServer> {
  let callbackPort = 0
  let callbackPath = ''
  let secret = ''
  const methods: string[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      if (req.method !== 'POST') return void res.writeHead(405).end()
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        id?: number
        method?: string
        params?: Record<string, string>
      }
      methods.push(message.method ?? '')
      if (message.id === undefined) return void res.writeHead(202).end()
      let result: unknown = {}
      if (message.method === 'initialize')
        result = {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'fake', version: '1' },
        }
      if (message.method === 'events/subscribe') {
        const given = new URL(message.params?.callbackUrl ?? '')
        // A test double only ever delivers to this machine; refuse any other host rather than fetch it.
        if (given.hostname !== '127.0.0.1' && given.hostname !== 'localhost')
          return void res.writeHead(400).end()
        const port = Number(given.port)
        if (!Number.isInteger(port) || port <= 0 || !/^\/[\w\-./]*$/.test(given.pathname))
          return void res.writeHead(400).end()
        callbackPort = port
        callbackPath = given.pathname
        secret = message.params?.secret ?? ''
        result = { subscriptionId: 'sub-1' }
      }
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    methods,
    emit: async (body, given) => {
      const text = JSON.stringify({ subscriptionId: 'sub-1', ...body })
      // The target host is fixed: only the port and path the subscriber gave are reused, after validation.
      return new Promise<number>((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: callbackPort,
            path: callbackPath,
            method: 'POST',
            headers: {
              'x-mcp-signature': signMcpEvent(given ?? secret, text),
              'content-type': 'application/json',
            },
          },
          (response) => {
            response.resume()
            response.on('end', () => resolve(response.statusCode ?? 0))
          },
        )
        req.on('error', reject)
        req.end(text)
      })
    },
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}
