import { randomUUID } from 'node:crypto'
import http from 'node:http'

import { bearerCheck } from '../control-plane/bearer.js'
import { GrantStore } from './grants.js'

/**
 * OC-116 — the hosted MCP relay a remote MCP client adds as a connector URL. `POST /mcp` (client
 * token) queues a job for the instance and waits for its answer; the instance long-polls
 * `POST /instance/poll` and answers with `POST /instance/respond` (instance token). Separate from
 * the instance-to-instance mailbox in `../relay/relay-server.ts`. Grants are re-read on every
 * request so a revoke takes effect at once. Nothing here logs a token.
 */

export const MCP_PATH = '/mcp'
export const POLL_PATH = '/instance/poll'
export const RESPOND_PATH = '/instance/respond'
const MAX_BODY_BYTES = 256 * 1024
export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_POLL_MS = 25_000

export interface RelayJob {
  readonly id: string
  readonly client: string
  readonly allowedTools: readonly string[]
  readonly body: unknown
}

export interface McpRelayOptions {
  readonly instanceToken: string
  readonly grantsPath: string
  readonly timeoutMs?: number
  readonly pollMs?: number
}

class TooLarge extends Error {}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new TooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(res: http.ServerResponse, status: number, body?: unknown, headers = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers).end()
    return
  }
  res
    .writeHead(status, { 'content-type': 'application/json', ...headers })
    .end(JSON.stringify(body))
}

export function createMcpRelay(options: McpRelayOptions): http.Server {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const authorizeInstance = bearerCheck(options.instanceToken)
  const queue: RelayJob[] = []
  const waiting = new Map<string, (response: unknown) => void>()
  const pollers = new Set<() => void>()

  const wake = (): void => {
    for (const poller of [...pollers]) poller()
  }

  const clientGrant = (authorization: string | undefined) => {
    const token = /^bearer (.+)$/i.exec(authorization ?? '')?.[1]
    if (token === undefined) return undefined
    try {
      return new GrantStore(options.grantsPath).load().authenticate(token)
    } catch {
      return undefined
    }
  }

  async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const grant = clientGrant(req.headers.authorization)
    if (grant === undefined) return send(res, 401, undefined, { 'www-authenticate': 'Bearer' })
    let body: unknown
    try {
      body = JSON.parse(await readBody(req))
    } catch (error) {
      return send(res, error instanceof TooLarge ? 413 : 400)
    }
    if (typeof body !== 'object' || body === null) return send(res, 400)
    const job: RelayJob = {
      id: randomUUID(),
      client: grant.name,
      allowedTools: grant.tools,
      body,
    }
    const notification = !Array.isArray(body) && !('id' in body)
    queue.push(job)
    wake()
    if (notification) return send(res, 202)
    const response = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs)
      waiting.set(job.id, (value) => {
        clearTimeout(timer)
        resolve(value)
      })
      res.once('close', () => clearTimeout(timer))
    })
    waiting.delete(job.id)
    const queued = queue.indexOf(job)
    if (queued >= 0) queue.splice(queued, 1)
    if (response === undefined) return send(res, 504)
    send(res, 200, response)
  }

  async function handlePoll(res: http.ServerResponse): Promise<void> {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        pollers.delete(done)
        resolve()
      }
      const timer = setTimeout(done, pollMs)
      pollers.add(done)
      res.once('close', done)
      if (queue.length > 0) done()
    })
    send(res, 200, { jobs: queue.splice(0) })
  }

  async function handleRespond(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let parsed: { id?: unknown; response?: unknown }
    try {
      parsed = JSON.parse(await readBody(req)) as typeof parsed
    } catch (error) {
      return send(res, error instanceof TooLarge ? 413 : 400)
    }
    const complete = typeof parsed?.id === 'string' ? waiting.get(parsed.id) : undefined
    if (typeof parsed?.id !== 'string' || parsed.response === undefined) return send(res, 400)
    if (complete === undefined) return send(res, 404)
    waiting.delete(parsed.id)
    complete(parsed.response)
    send(res, 204)
  }

  return http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://relay').pathname
    const route =
      path === MCP_PATH
        ? handleMcp
        : path === POLL_PATH
          ? (_: http.IncomingMessage, r: http.ServerResponse) => handlePoll(r)
          : path === RESPOND_PATH
            ? handleRespond
            : undefined
    if (route === undefined) return send(res, 404)
    if (req.method !== 'POST') return send(res, 405, undefined, { allow: 'POST' })
    if (path !== MCP_PATH && !authorizeInstance(req.headers.authorization)) {
      return send(res, 401, undefined, { 'www-authenticate': 'Bearer' })
    }
    route(req, res).catch(() => {
      if (!res.headersSent) send(res, 500)
      else res.end()
    })
  })
}
