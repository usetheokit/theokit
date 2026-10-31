import { isWebchatPath } from '../webchat/paths.js'
import type { DevicePairing } from './device-pairing.js'
import { healthHandler } from './listener.js'
import { PAIR_PATH, pairRoute } from './pair-route.js'

/** What the one listener serves a request with. */
export type HttpHandler = (request: Request) => Promise<Response>

/** A handler that answers only its own paths, and `undefined` for any other. */
export type PartialHandler = (request: Request) => Promise<Response | undefined>

/**
 * Which handler a request on the one listener goes to: `GET /health` is the control plane's;
 * `POST /control/pair` is the device pairing's when it is on (OC-91);
 * `/webchat` paths go to WebChat when it is on and answer 404 when it is off; the HTTP API (with a
 * control token) answers its own paths; every other path goes to the webhook router, which answers
 * 404 for an API path while the API is off.
 */
export function serveHandler(
  router: HttpHandler,
  webchat: HttpHandler | undefined,
  devices?: DevicePairing,
  api?: PartialHandler,
): HttpHandler {
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return healthHandler(request)
    if (pathname === PAIR_PATH && devices !== undefined) return pairRoute(devices, request)
    if (isWebchatPath(pathname)) return webchat === undefined ? new Response(null, { status: 404 }) : webchat(request)
    return (await api?.(request)) ?? router(request)
  }
}
