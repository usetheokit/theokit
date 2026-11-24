import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { join } from 'node:path'
import type { Writable } from 'node:stream'

import { applyOutboundProxy, validateProxy as hostValidateProxy } from '@theokit/host'

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

/** Routes this process's `fetch` through the debug proxy if set, else the operator proxy. */
export function applyProxyEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  const variable = env.THEOCLAW_DEBUG_PROXY_URL?.trim() ? 'THEOCLAW_DEBUG_PROXY_URL' : 'THEOCLAW_PROXY_URL'
  return applyOutboundProxy(env, { variable }).installed ? env[variable]!.trim() : undefined
}

export interface Validation {
  readonly ok: boolean
  readonly message: string
}

/** The proxy's scheme and host, without credentials, for the output line. */
function shownProxy(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl)
    return `${url.protocol}//${url.host}`
  } catch {
    return 'the proxy'
  }
}

/** Runs the host's CONNECT probe and maps its result to one output line (no URL credentials). */
async function checkProxy(proxyUrl: string, target: string): Promise<Validation> {
  const result = await hostValidateProxy(proxyUrl, { target, timeoutMs: TIMEOUT_MS })
  const shown = shownProxy(proxyUrl)
  if (result.ok) return { ok: true, message: `${shown} is reachable and tunnels to ${target}` }
  if (result.reason === 'connect_refused')
    return { ok: false, message: `${shown} is reachable but refused the tunnel to ${target} (HTTP ${result.statusCode ?? '?'})` }
  return { ok: false, message: `${shown}: ${result.message}` }
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
      res.writeHead(400).end('http URL expected')
      return
    }
    record(req.method ?? 'GET', `${url.host}${url.pathname}`)
    // A forward proxy reaches the host the client names; that is the feature. Only http is forwarded.
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
    const result = await checkProxy(url.trim(), option(rest, '--target') ?? DEFAULT_TARGET)
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
