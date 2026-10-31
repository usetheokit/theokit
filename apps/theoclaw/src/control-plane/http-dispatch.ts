import { isWebchatPath } from '../webchat/paths.js'
import { healthHandler } from './listener.js'

/** What the one listener serves a request with. */
export type HttpHandler = (request: Request) => Promise<Response>

/**
 * Which handler a request on the one listener goes to: `GET /health` is the control plane's;
 * `/webchat` paths go to WebChat when it is on and answer 404 when it is off; every other path goes
 * to the webhook router.
 */
export function serveHandler(router: HttpHandler, webchat: HttpHandler | undefined): HttpHandler {
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return healthHandler(request)
    if (!isWebchatPath(pathname)) return router(request)
    return webchat === undefined ? new Response(null, { status: 404 }) : webchat(request)
  }
}
