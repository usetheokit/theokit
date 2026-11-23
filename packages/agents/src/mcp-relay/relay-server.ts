import { randomUUID } from 'node:crypto'
import http from 'node:http'

import { bearerCheck, type Grant, type GrantStore } from '@theokit/http/guards'

/** A queued remote MCP request, scoped by the grant that sent it. */
export interface RelayJob {
  readonly id: string
  readonly client: string
  readonly scopes: readonly string[]
  readonly body: unknown
}

export interface McpRelayServerOptions {
  /** The bearer token the local connector presents on `/instance/*`. */
  readonly instanceToken: string
  /** Where remote clients' credentials are checked; re-read per request, so revoke is immediate. */
  readonly grants: Pick<GrantStore, 'authenticate'>
  /** How long a remote request waits for the connector's answer. Default 30 000. */
  readonly timeoutMs?: number
  /** How long a poll is held open when nothing is queued. Default 25 000. */
  readonly pollMs?: number
  /** Largest accepted request body. Default 256 KiB. */
  readonly maxBodyBytes?: number
  /** Most requests held waiting for the connector; beyond it the relay answers 503. Default 64. */
  readonly maxQueued?: number
}

export const MCP_PATH = '/mcp'
export const POLL_PATH = '/instance/poll'
export const RESPOND_PATH = '/instance/respond'

class TooLarge extends Error {}

type Route = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>

function send(res: http.ServerResponse, status: number, body?: unknown, headers = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers).end()
    return
  }
  res
    .writeHead(status, { 'content-type': 'application/json', ...headers })
    .end(JSON.stringify(body))
}

/**
 * The hosted side of the reverse MCP relay. A remote client `POST`s MCP to `/mcp` with its grant
 * credential; the request waits until the connector long-polls `/instance/poll` and answers on
 * `/instance/respond`. Returns an unstarted `http.Server`; the caller listens.
 */
export function createMcpRelayServer(options: McpRelayServerOptions): http.Server {
  const timeoutMs = options.timeoutMs ?? 30_000
  const pollMs = options.pollMs ?? 25_000
  const maxBody = options.maxBodyBytes ?? 256 * 1024
  const maxQueue = options.maxQueued ?? 64
  const authorizeInstance = bearerCheck(options.instanceToken)
  const queue: RelayJob[] = []
  const waiting = new Map<string, (response: unknown) => void>()
  const pollers = new Set<() => void>()

  async function readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length
      if (size > maxBody) throw new TooLarge()
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  async function grantFor(authorization: string | undefined): Promise<Grant | undefined> {
    const token = /^bearer (.+)$/i.exec(authorization ?? '')?.[1]
    if (token === undefined) return undefined
    try {
      return await options.grants.authenticate(token)
    } catch {
      return undefined
    }
  }

  async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const grant = await grantFor(req.headers.authorization)
    if (grant === undefined) {
      send(res, 401, undefined, { 'www-authenticate': 'Bearer' })
      return
    }
    let body: unknown
    try {
      body = JSON.parse(await readBody(req))
    } catch (error) {
      send(res, error instanceof TooLarge ? 413 : 400)
      return
    }
    if (typeof body !== 'object' || body === null) {
      send(res, 400)
      return
    }
    const job: RelayJob = { id: randomUUID(), client: grant.name, scopes: grant.scopes, body }
    if (queue.length >= maxQueue) {
      send(res, 503, undefined, { 'retry-after': '5' })
      return
    }
    queue.push(job)
    for (const poller of [...pollers]) poller()
    const items: unknown[] = Array.isArray(body) ? body : [body]
    if (
      items.length > 0 &&
      items.every((i) => typeof i === 'object' && i !== null && !('id' in i))
    ) {
      send(res, 202)
      return
    }
    const response = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        resolve(undefined)
      }, timeoutMs)
      waiting.set(job.id, (value) => {
        clearTimeout(timer)
        resolve(value)
      })
      res.once('close', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
    })
    waiting.delete(job.id)
    const queued = queue.indexOf(job)
    if (queued >= 0) queue.splice(queued, 1)
    if (response === undefined) {
      send(res, 504)
      return
    }
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
    if (res.destroyed) return
    send(res, 200, { jobs: queue.splice(0) })
  }

  async function handleRespond(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let parsed: { id?: unknown; response?: unknown }
    try {
      parsed = JSON.parse(await readBody(req)) as typeof parsed
    } catch (error) {
      send(res, error instanceof TooLarge ? 413 : 400)
      return
    }
    if (typeof parsed.id !== 'string' || parsed.response === undefined) {
      send(res, 400)
      return
    }
    const complete = waiting.get(parsed.id)
    if (complete === undefined) {
      send(res, 404)
      return
    }
    waiting.delete(parsed.id)
    complete(parsed.response)
    send(res, 204)
  }

  return http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'https://relay.invalid').pathname
    const routes: Partial<Record<string, Route>> = {
      [MCP_PATH]: handleMcp,
      [POLL_PATH]: (_req, r) => handlePoll(r),
      [RESPOND_PATH]: handleRespond,
    }
    const route = routes[path]
    if (route === undefined) {
      send(res, 404)
      return
    }
    if (req.method !== 'POST') {
      send(res, 405, undefined, { allow: 'POST' })
      return
    }
    if (path !== MCP_PATH && !authorizeInstance(req.headers.authorization)) {
      send(res, 401, undefined, { 'www-authenticate': 'Bearer' })
      return
    }
    route(req, res).catch(() => {
      if (!res.headersSent) send(res, 500)
      else res.end()
    })
  })
}
