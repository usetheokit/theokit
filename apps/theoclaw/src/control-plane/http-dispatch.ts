import { isA2APath } from '../a2a/a2a-route.js'
import { isWebchatPath } from '../webchat/paths.js'
import type { DevicePairing } from './device-pairing.js'
import { healthHandler } from './listener.js'
import { PAIR_PATH, pairRoute } from './pair-route.js'

/** What the one listener serves a request with. */
export type HttpHandler = (request: Request) => Promise<Response>

/**
 * Which handler a request on the one listener goes to: `GET /health` is the control plane's;
 * `POST /control/pair` is the device pairing's when it is on (OC-91);
 * `/a2a` and `/.well-known/agent-card.json` go to the A2A route when it is on and answer 404 when it
 * is off, never the webhook router (B-394); `/webchat` paths go to WebChat when it is on and answer
 * 404 when it is off; every other path goes to the webhook router.
 */
export function serveHandler(router: HttpHandler, webchat: HttpHandler | undefined, devices?: DevicePairing, a2a?: HttpHandler): HttpHandler {
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return healthHandler(request)
    if (pathname === PAIR_PATH && devices !== undefined) return pairRoute(devices, request)
    if (isA2APath(pathname)) return a2a === undefined ? new Response(null, { status: 404 }) : a2a(request)
    if (!isWebchatPath(pathname)) return router(request)
    return webchat === undefined ? new Response(null, { status: 404 }) : webchat(request)
  }
}
