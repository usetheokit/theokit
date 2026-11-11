import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { ProxyAgent, setGlobalDispatcher } from 'undici'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'

/**
 * `theoclaw proxy validate | start | sessions` (OC-131).
 *
 * `validate` checks the operator's proxy (`--proxy-url`, `THEOCLAW_PROXY_URL`, `HTTPS_PROXY`): it
 * opens a CONNECT tunnel through it to a target host and reports whether the proxy answers.
 * `start` runs a local capture proxy that tunnels and records every request's method, host and
 * time (HTTPS stays opaque: no CA, no body); a process started with `THEOCLAW_DEBUG_PROXY_URL`
 * routes its outgoing `fetch` through it, so a turn's provider request is listed by `sessions`.
 */

export interface ProxyIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
  readonly stderr: Writable
  readonly signals?: { on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown }
}

const USAGE = 'theoclaw proxy: expected validate [--proxy-url <url>] [--target <host:port>] | start [--port <n>] | sessions'
const DEFAULT_TARGET = 'api.openai.com:443'
const TIMEOUT_MS = 5000

export function capturePath(env: NodeJS.ProcessEnv, homeDir: string): string {
  const base = (env.THEOCLAW_STATE_DIR ?? '').trim() || join(homeDir, '.theoclaw')
  return join(base, 'debug-proxy', 'captures.jsonl')
}

/** Routes this process's `fetch` through the operator or debug proxy named in the environment. */
export function applyProxyEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  const url = (env.THEOCLAW_DEBUG_PROXY_URL ?? env.THEOCLAW_PROXY_URL ?? '').trim()
  if (url === '') return undefined
  setGlobalDispatcher(new ProxyAgent(url))
  return url
}

export interface Validation {
  readonly ok: boolean
  readonly message: string
}

/** CONNECT through the proxy to the target; any HTTP status line from the proxy proves it is reachable. */
export function validateProxy(proxyUrl: string, target: string, timeoutMs = TIMEOUT_MS): Promise<Validation> {
  let url: URL
  try {
    url = new URL(proxyUrl)
  } catch {
    return Promise.resolve({ ok: false, message: 'the proxy URL is not a valid URL' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return Promise.resolve({ ok: false, message: `unsupported proxy scheme ${url.protocol}` })
  if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(target))
    return Promise.resolve({ ok: false, message: `the target ${target} is not host:port` })
  // The operator's own proxy URL is the host this command exists to reach (CodeQL js/request-forgery).
  const shown = `${url.protocol}//${url.host}`
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) })
    let done = false
    const finish = (result: Validation): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish({ ok: false, message: `${shown} did not answer within ${timeoutMs} ms` }))
    socket.on('error', (error) => finish({ ok: false, message: `${shown} is unreachable: ${error.message}` }))
    socket.on('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`))
    let head = ''
    socket.on('data', (chunk: Buffer) => {
      head += chunk.toString('latin1')
      const line = /^HTTP\/1\.[01] (\d{3})/.exec(head)
      if (line === null) {
        if (head.length > 1024) finish({ ok: false, message: `${shown} did not answer with HTTP` })
        return
      }
      const status = Number(line[1])
      finish(
        status === 200
          ? { ok: true, message: `${shown} is reachable and tunnels to ${target}` }
          : { ok: false, message: `${shown} is reachable but refused the tunnel to ${target} (HTTP ${status})` },
      )
    })
  })
}

export interface Capture {
  readonly at: string
  readonly method: string
  readonly target: string
}

/** A local forward proxy that records each request, then tunnels or forwards it. */
export function startCaptureProxy(file: string, port: number): Promise<http.Server> {
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
  const record = (method: string, target: string): void =>
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), method, target } satisfies Capture)}\n`, { mode: 0o600 })
  const server = http.createServer((req, res) => {
    let url: URL
    try {
      url = new URL(req.url ?? '')
    } catch {
      res.writeHead(400).end('absolute URL expected')
      return
    }
    if (url.protocol !== 'http:') {
      res.writeHead(400).end('only http: URLs are forwarded; use CONNECT for https')
      return
    }
    record(req.method ?? 'GET', `${url.host}${url.pathname}`)
    // CodeQL js/request-forgery: forwarding to the URL the client names is what a forward proxy
    // does. The listener binds 127.0.0.1 only, and only the http: scheme is forwarded.
    const upstream = http.request(url, { method: req.method, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    })
    upstream.on('error', () => res.headersSent || res.writeHead(502).end())
    req.pipe(upstream)
  })
  server.on('connect', (req, client: net.Socket, head) => {
    const target = req.url ?? ''
    const [host = '', portText = '443'] = target.split(':')
    record('CONNECT', target)
    const upstream = net.connect({ host, port: Number(portText) || 443 }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

export function readCaptures(file: string): Capture[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Capture]
      } catch {
        return []
      }
    })
}

function option(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  if (at < 0) return undefined
  const value = args[at + 1]
  if (value === undefined || value.startsWith('-')) throw new UsageError(USAGE)
  return value
}

export async function proxyCommand(args: readonly string[], io: ProxyIo): Promise<number> {
  const [verb, ...rest] = args
  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const file = capturePath(env, io.homeDir)
  if (verb === 'validate') {
    const url = option(rest, '--proxy-url') ?? env.THEOCLAW_PROXY_URL ?? env.HTTPS_PROXY ?? env.https_proxy
    if (url === undefined || url.trim() === '') {
      io.stdout.write('proxy validation requires --proxy-url, THEOCLAW_PROXY_URL or HTTPS_PROXY\n')
      return 1
    }
    const result = await validateProxy(url.trim(), option(rest, '--target') ?? DEFAULT_TARGET)
    io.stdout.write(`${result.ok ? 'ok' : 'failed'}: ${result.message}\n`)
    return result.ok ? 0 : 1
  }
  if (verb === 'sessions') {
    if (rest.length > 0) throw new UsageError(USAGE)
    const captures = readCaptures(file)
    io.stdout.write(`${captures.length} captured request(s) in ${file}\n`)
    for (const c of captures) io.stdout.write(`${c.at} ${c.method} ${c.target}\n`)
    return 0
  }
  if (verb === 'start') {
    const raw = option(rest, '--port') ?? '0'
    if (!/^\d{1,5}$/.test(raw)) throw new UsageError(USAGE)
    const server = await startCaptureProxy(file, Number(raw))
    const address = server.address() as net.AddressInfo
    io.stdout.write(`Debug proxy: http://127.0.0.1:${address.port}\nCaptures: ${file}\nStart theoclaw with THEOCLAW_DEBUG_PROXY_URL set to this URL.\n`)
    await new Promise<void>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) io.signals?.on(signal, resolve)
      if (io.signals === undefined) server.once('close', resolve)
    })
    server.close()
    server.closeAllConnections()
    return 0
  }
  throw new UsageError(USAGE)
}
