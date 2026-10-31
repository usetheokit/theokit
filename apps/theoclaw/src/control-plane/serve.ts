import { isIPv6 } from 'node:net'

import { healthHandler } from './listener.js'
import type { ControlPlaneSettings } from './settings.js'

/** What the one listener serves a request with. */
export type HttpHandler = (request: Request) => Promise<Response>

/** `/webchat` itself or anything under `/webchat/`, and not `/webchatx` (EC-4). */
function isWebchatPath(pathname: string): boolean {
  return pathname === '/webchat' || pathname.startsWith('/webchat/')
}

/**
 * `GET /health` is the control plane's; `/webchat` paths go to WebChat when it is on and answer 404
 * when it is off; every other path goes to the webhook router.
 */
export function serveHandler(router: HttpHandler, webchat: HttpHandler | undefined): HttpHandler {
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return healthHandler(request)
    if (!isWebchatPath(pathname)) return router(request)
    return webchat === undefined ? new Response(null, { status: 404 }) : webchat(request)
  }
}

/** One line for each owner surface left off because its token is unset. */
export function reportSurfacesOff(
  settings: ControlPlaneSettings,
  stdout: (line: string) => void,
): void {
  if (settings.controlToken === undefined) {
    stdout('theoclaw: control socket off (THEOCLAW_CONTROL_TOKEN unset)')
  }
  if (settings.webchatToken === undefined) {
    stdout('theoclaw: webchat off (THEOCLAW_WEBCHAT_TOKEN unset)')
  }
}

/** A bound address as the listening line writes it, an IPv6 host in brackets. */
export function formatAddress(address: { readonly host: string; readonly port: number }): string {
  return isIPv6(address.host) ? `[${address.host}]:${address.port}` : `${address.host}:${address.port}`
}
