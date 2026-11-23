import * as http from 'node:http'
import * as https from 'node:https'

import { ProxyAgent, setGlobalDispatcher } from 'undici'

export interface ApplyOutboundProxyOptions {
  /** Name of the environment variable that holds the proxy URL. */
  variable: string
}

export interface ApplyOutboundProxyResult {
  /** True when a proxy dispatcher was installed for global `fetch`. */
  installed: boolean
}

/**
 * Routes this process's global `fetch` through the proxy named by
 * `env[variable]`. With the variable unset or blank nothing is installed.
 * The dispatcher is process-wide.
 */
export function applyOutboundProxy(
  env: Readonly<Record<string, string | undefined>>,
  options: ApplyOutboundProxyOptions,
): ApplyOutboundProxyResult {
  const url = env[options.variable]?.trim()
  if (!url) return { installed: false }
  setGlobalDispatcher(new ProxyAgent(url))
  return { installed: true }
}

export interface ValidateProxyOptions {
  /** `host:port` the proxy is asked to CONNECT to. */
  target: string
  /** Give up after this many milliseconds. Default 5000. */
  timeoutMs?: number
}

export type ValidateProxyFailureReason =
  | 'invalid_proxy_url'
  | 'connect_refused'
  | 'timeout'
  | 'connection_error'

export type ValidateProxyResult =
  | { ok: true; statusCode: number }
  | {
      ok: false
      reason: ValidateProxyFailureReason
      message: string
      statusCode?: number
    }

/** Reports whether a CONNECT to `target` through the proxy at `url` succeeds. */
export function validateProxy(
  url: string,
  options: ValidateProxyOptions,
): Promise<ValidateProxyResult> {
  const timeoutMs = options.timeoutMs ?? 5000
  let proxy: URL
  try {
    proxy = new URL(url)
    if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') throw new Error('protocol')
  } catch {
    return Promise.resolve({
      ok: false,
      reason: 'invalid_proxy_url',
      message: 'Proxy URL is not a valid http or https URL',
    })
  }

  return new Promise((resolve) => {
    let settled = false
    const headers: Record<string, string> = { Host: options.target }
    if (proxy.username) {
      const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`
    }
    const mod = proxy.protocol === 'https:' ? https : http
    const req = mod.request({
      host: proxy.hostname.replace(/^\[|\]$/g, ''),
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: options.target,
      headers,
    })
    const done = (result: ValidateProxyResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => {
      done({
        ok: false,
        reason: 'timeout',
        message: `No CONNECT response within ${timeoutMs}ms`,
      })
    }, timeoutMs)
    req.on('connect', (res, socket) => {
      socket.destroy()
      const statusCode = res.statusCode ?? 0
      done(
        statusCode >= 200 && statusCode < 300
          ? { ok: true, statusCode }
          : {
              ok: false,
              reason: 'connect_refused',
              message: `Proxy answered CONNECT with ${statusCode}`,
              statusCode,
            },
      )
    })
    req.on('response', (res) => {
      res.resume()
      const statusCode = res.statusCode ?? 0
      done({
        ok: false,
        reason: 'connect_refused',
        message: `Proxy answered CONNECT with ${statusCode}`,
        statusCode,
      })
    })
    // Error messages can echo the proxy URL, so report only the error code.
    req.on('error', (error: NodeJS.ErrnoException) => {
      done({
        ok: false,
        reason: 'connection_error',
        message: `Could not reach the proxy (${error.code ?? 'error'})`,
      })
    })
    req.end()
  })
}
