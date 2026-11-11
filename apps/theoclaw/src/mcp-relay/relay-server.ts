import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { bearerCheck } from '../control-plane/bearer.js'

/**
 * OC-116 — the hosted MCP relay a remote MCP client adds as a connector URL. Clients `POST /mcp`
 * with a client token; the instance connector long-polls `/instance/poll` and answers through
 * `/instance/respond` with the instance token. Separate from the instance mailbox in
 * `relay/relay-server.ts`. Tokens are never logged.
 */

export const MAX_BODY_BYTES = 256 * 1024
export const DEFAULT_MCP_TIMEOUT_MS = 30_000
export const DEFAULT_POLL_MS = 25_000

export interface McpRelayJob {
  readonly id: string
  readonly client: string
  readonly allowedTools: readonly string[]
  readonly body: unknown
}

export interface McpRelayOptions {
  readonly instanceToken: string
  /** `<state dir>/mcp-relay-grants.json`, re-read on each request. */
  readonly grantsPath: string
  readonly timeoutMs?: number
  readonly pollMs?: number
}

interface Grant {
  readonly name: string
  readonly tokenHash: string
  readonly tools: readonly string[]
}

function readGrants(path: string): Grant[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { grants?: unknown }
    if (!Array.isArray(parsed.grants)) return []
    const out: Grant[] = []
    for (const g of parsed.grants as Record<string, unknown>[]) {
      if (typeof g !== 'object' || g === null) continue
      if (g['revokedAt'] !== undefined && g['revokedAt'] !== null) continue
      if (typeof g['tokenHash'] !== 'string' || typeof g['name'] !== 'string') continue
      const tools = Array.isArray(g['tools']) ? g['tools'].filter((t) => typeof t === 'string') : []
      out.push({ name: g['name'], tokenHash: g['tokenHash'], tools })
    }
    return out
  } catch {
    return []
  }
}

function matchGrant(path: string, token: string): Grant | undefined {
  const presented = createHash('sha256').update(token).digest()
  let found: Grant | undefined
  for (const grant of readGrants(path)) {
    const stored = Buffer.from(grant.tokenHash, 'hex')
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) found ??= grant
  }
  return found
}

const BEARER = /^bearer (.+)$/i

class TooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new TooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): void {
  if (body === undefined) {
    res.writeHead(status, headers)
    res.end()
    return
  }
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(payload)
}

function unauthorized(res: ServerResponse): void {
  send(res, 401, undefined, { 'www-authenticate': 'Bearer' })
}

export function createMcpRelayServer(options: McpRelayOptions): Server {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const isInstance = bearerCheck(options.instanceToken)
  const queue: McpRelayJob[] = []
  const pending = new Map<string, (response: unknown) => void>()
  const waiters = new Set<() => void>()

  const wake = (): void => {
    for (const w of [...waiters]) w()
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1]
    const grant = token === undefined ? undefined : matchGrant(options.grantsPath, token)
    if (grant === undefined) return unauthorized(res)
    let body: unknown
    try {
      body = JSON.parse(await readBody(req))
    } catch (error) {
      return send(res, error instanceof TooLarge ? 413 : 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return send(res, 400)
    const id = randomUUID()
    const job: McpRelayJob = { id, client: grant.name, allowedTools: grant.tools, body }
    const isNotification = !('id' in body)
    let timer: NodeJS.Timeout | undefined
    const answer = isNotification
      ? undefined
      : new Promise<unknown>((resolve) => {
          pending.set(id, resolve)
          timer = setTimeout(() => {
            pending.delete(id)
            const at = queue.findIndex((j) => j.id === id)
            if (at >= 0) queue.splice(at, 1)
            resolve(undefined)
          }, timeoutMs)
        })
    queue.push(job)
    wake()
    if (answer === undefined) return send(res, 202)
    const response = await answer
    clearTimeout(timer)
    if (response === undefined) return send(res, 504)
    send(res, 200, response)
  }

  async function handlePoll(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await readBody(req)
    } catch {
      return send(res, 413)
    }
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(t)
          waiters.delete(done)
          req.off('close', done)
          resolve()
        }
        const t = setTimeout(done, pollMs)
        waiters.add(done)
        req.once('close', done)
      })
    }
    if (res.destroyed) return
    send(res, 200, { jobs: queue.splice(0) })
  }

  async function handleRespond(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: unknown
    try {
      body = JSON.parse(await readBody(req))
    } catch (error) {
      return send(res, error instanceof TooLarge ? 413 : 400)
    }
    const { id, response } = (body ?? {}) as { id?: unknown; response?: unknown }
    if (typeof id !== 'string' || response === undefined) return send(res, 400)
    const resolve = pending.get(id)
    if (resolve === undefined) return send(res, 404)
    pending.delete(id)
    resolve(response)
    send(res, 204)
  }

  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://relay').pathname
    const route =
      path === '/mcp'
        ? handleMcp
        : path === '/instance/poll'
          ? handlePoll
          : path === '/instance/respond'
            ? handleRespond
            : undefined
    if (route === undefined) return send(res, 404)
    if (req.method !== 'POST') return send(res, 405, undefined, { allow: 'POST' })
    if (route !== handleMcp && !isInstance(req.headers.authorization)) return unauthorized(res)
    route(req, res).catch(() => {
      if (!res.headersSent) send(res, 500)
      else res.end()
    })
  })
}
