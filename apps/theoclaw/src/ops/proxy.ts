import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

/**
 * `theoclaw proxy` (OC-131): `validate` checks the operator's proxy (`--proxy-url` or
 * `THEOCLAW_PROXY_URL`) by a CONNECT to a target; `start` runs a local capture proxy that logs each
 * request's method and host to `<state>/debug-proxy/captures.jsonl`; `captures` lists them.
 * HTTPS is tunnelled, not decrypted: a capture holds the host, never a body or a header.
 */
export interface ProxyIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
  readonly stderr: Writable
  readonly signals: { on(signal: NodeJS.Signals, listener: () => void): unknown }
}

export interface Capture {
  readonly at: string
  readonly method: string
  readonly host: string
  readonly path?: string
}

const DEFAULT_TARGET = 'api.anthropic.com:443'

function captureFile(env: NodeJS.ProcessEnv, homeDir: string): string {
  return join(env.THEOCLAW_STATE_DIR?.trim() || join(homeDir, '.theoclaw'), 'debug-proxy', 'captures.jsonl')
}

export function readCaptures(file: string): Capture[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Capture)
}

/** CONNECT `target` through the proxy at `proxyUrl`; resolves with the proxy's status code. */
export function probeProxy(proxyUrl: string, target: string, timeoutMs = 5000): Promise<number> {
  const url = new URL(proxyUrl)
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(Number(url.port || 80), url.hostname)
    let buffer = ''
    const fail = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(timeoutMs, () => fail(new Error('timed out')))
    socket.once('error', fail)
    socket.once('connect', () => {
      const auth = url.username ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}\r\n` : ''
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1')
      const end = buffer.indexOf('\r\n')
      if (end < 0) return
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(buffer.slice(0, end))
      socket.destroy()
      if (status === null) reject(new Error('not an HTTP proxy'))
      else resolve(Number(status[1]))
    })
    socket.once('close', () => reject(new Error('closed before a reply')))
  })
}

/** A forward proxy that records each request and passes it on. */
export function createCaptureProxy(file: string): Server {
  mkdirSync(join(file, '..'), { recursive: true })
  const record = (capture: Omit<Capture, 'at'>): void => {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...capture })}\n`)
  }
  const server = createServer((req: IncomingMessage, res) => {
    let url: URL
    try {
      url = new URL(req.url ?? '')
    } catch {
      res.writeHead(400).end('absolute URL required')
      return
    }
    record({ method: req.method ?? 'GET', host: url.host, path: url.pathname })
    const { 'proxy-authorization': _drop, ...headers } = req.headers
    const upstream = httpRequest({ host: url.hostname, port: url.port || 80, method: req.method, path: url.pathname + url.search, headers }, (back) => {
      res.writeHead(back.statusCode ?? 502, back.headers)
      back.pipe(res)
    })
    upstream.on('error', () => res.headersSent || res.writeHead(502).end())
    req.pipe(upstream)
  })
  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    const host = req.url ?? ''
    record({ method: 'CONNECT', host })
    const [name = '', port = '443'] = host.split(':')
    const upstream = connect(Number(port), name, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'))
    client.on('error', () => upstream.destroy())
  })
  return server
}

export async function proxyCommand(args: readonly string[], io: ProxyIo): Promise<number> {
  const [verb, ...rest] = args
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const flags = new Map<string, string>()
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]
    const value = rest[i + 1]
    if (name === undefined || !['--proxy-url', '--target', '--port'].includes(name) || value === undefined) {
      throw new UsageError(`theoclaw proxy: ${name === undefined ? 'missing flag' : `bad or valueless flag ${name}`}; expected validate [--proxy-url <url>] [--target <host:port>] | start [--port <n>] | captures`)
    }
    flags.set(name, value)
  }
  const file = captureFile(env, io.homeDir)
  if (verb === 'validate') {
    const proxyUrl = flags.get('--proxy-url') ?? env.THEOCLAW_PROXY_URL?.trim()
    if (!proxyUrl) throw new TheoClawConfigError('proxy validation requires --proxy-url or THEOCLAW_PROXY_URL')
    let shown: string
    try {
      const parsed = new URL(proxyUrl)
      if (parsed.protocol !== 'http:') throw new Error('scheme')
      shown = parsed.host
    } catch {
      throw new TheoClawConfigError('the proxy URL must be an http:// URL')
    }
    const target = flags.get('--target') ?? DEFAULT_TARGET
    try {
      const status = await probeProxy(proxyUrl, target)
      if (status !== 200) {
        io.stderr.write(`theoclaw: proxy ${shown} refused CONNECT ${target}: status ${status}\n`)
        return 1
      }
    } catch (error) {
      io.stderr.write(`theoclaw: proxy ${shown} is not reachable: ${(error as Error).message}\n`)
      return 1
    }
    io.stdout.write(`theoclaw: proxy ${shown} reachable; CONNECT ${target} ok\n`)
    return 0
  }
  if (verb === 'captures') {
    const captures = readCaptures(file)
    for (const c of captures) io.stdout.write(`${c.at} ${c.method} ${c.host}${c.path ?? ''}\n`)
    io.stdout.write(`${captures.length} captured\n`)
    return 0
  }
  if (verb === 'start') {
    const server = createCaptureProxy(file)
    await new Promise<void>((resolve) => server.listen(Number(flags.get('--port') ?? 0), '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    io.stdout.write(`Debug proxy: http://127.0.0.1:${port}\ncaptures: ${file}\nset THEOCLAW_PROXY_URL to it and run theoclaw start\n`)
    await new Promise<void>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) io.signals.on(signal, resolve)
    })
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return 0
  }
  throw new UsageError('theoclaw proxy: expected validate, start or captures')
}
