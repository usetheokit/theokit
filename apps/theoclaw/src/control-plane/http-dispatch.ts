import { type DevicePairing, pairRoute } from '@theokit/agents/control'
import { peerAddress } from '@theokit/http/runtime/node'

import { isA2APath } from '../a2a/a2a-route.js'
import { isRelayPath } from '../relay/relay-server.js'
import { isWebchatPath } from '../webchat/paths.js'
import type { CityLookup } from './geo-city.js'
import { healthHandler } from './listener.js'

/** The path a new device posts its setup code to (OC-91). */
const PAIR_PATH = '/control/pair'

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
 * `/relay/put` and `/relay/take` are the relay's (OC-14) and answer 404 while it is off.
 * `/a2a` and `/.well-known/agent-card.json` are reserved for A2A and answer 404 while it is off.
 */
export function serveHandler(
  router: HttpHandler,
  webchat: HttpHandler | undefined,
  devices?: DevicePairing,
  api?: PartialHandler,
  a2a?: HttpHandler,
  relay?: HttpHandler,
  cityOf?: CityLookup,
): HttpHandler {
  const pair = devices === undefined ? undefined : pairRoute(devices, { cityOf: (request) => cityOf?.(peerAddress(request)) })
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return healthHandler(request)
    if (pathname === PAIR_PATH && pair !== undefined) return pair(request)
    if (isA2APath(pathname)) return a2a === undefined ? new Response(null, { status: 404 }) : a2a(request)
    if (isRelayPath(pathname)) return relay === undefined ? new Response(null, { status: 404 }) : relay(request)
    if (isWebchatPath(pathname)) return webchat === undefined ? new Response(null, { status: 404 }) : webchat(request)
    return (await api?.(request)) ?? router(request)
  }
}
