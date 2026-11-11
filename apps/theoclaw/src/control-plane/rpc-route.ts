import { bearerCheck } from './bearer.js'
import type { DevicePairing } from './device-pairing.js'
import type { PartialHandler } from './http-dispatch.js'

/** The path prefix of the opt-in HTTP form of control-plane methods (OC-128). */
export const RPC_PREFIX = '/rpc/'

/**
 * `/rpc/<method>`: a few `/control` methods over HTTP behind the control bearer token. Only
 * `pending_devices` (GET) is served; any other method answers 400 `unsupported_method`, a wrong or
 * missing token 401. It answers its own paths only, so it is on exactly when the control token and
 * the device store are.
 */
export function rpcRoute(token: string, devices: DevicePairing): PartialHandler {
  const accepts = bearerCheck(token)
  return (request) => {
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith(RPC_PREFIX)) return Promise.resolve(undefined)
    if (!accepts(request.headers.get('authorization') ?? undefined)) {
      return Promise.resolve(
        Response.json(
          { error: 'unauthorized' },
          { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
        ),
      )
    }
    const method = pathname.slice(RPC_PREFIX.length)
    if (method !== 'pending_devices') {
      return Promise.resolve(
        Response.json({ error: 'unsupported_method', method }, { status: 400 }),
      )
    }
    if (request.method !== 'GET')
      return Promise.resolve(new Response(null, { status: 405, headers: { Allow: 'GET' } }))
    return Promise.resolve(Response.json({ ok: true, devices: devices.pending() }))
  }
}

/** `/rpc/*` ahead of `next` when both a control token and a device store exist; otherwise `next` alone. */
export function rpcFirst(
  token: string | undefined,
  devices: DevicePairing | undefined,
  next: PartialHandler | undefined,
): PartialHandler | undefined {
  if (token === undefined || devices === undefined) return next
  const rpc = rpcRoute(token, devices)
  return async (request) => (await rpc(request)) ?? next?.(request)
}
