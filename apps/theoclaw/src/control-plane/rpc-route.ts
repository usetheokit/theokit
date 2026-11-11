import { bearerCheck } from './bearer.js'
import { handleDeviceFrame } from './device-frames.js'
import type { DevicePairing } from './device-pairing.js'
import { MAX_MESSAGE_BYTES } from './limits.js'

const PREFIX = '/rpc/'
/** The control-plane methods the HTTP route exposes; `revoke_device` stays on the socket, which closes open sockets. */
const METHODS: ReadonlySet<string> = new Set(['pair_code', 'pending_devices', 'approve_device'])

function methodOf(pathname: string): string {
  const raw = pathname.slice(PREFIX.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function isRpcPath(pathname: string): boolean {
  return pathname.startsWith(PREFIX)
}

async function readId(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > MAX_MESSAGE_BYTES || text === '') return undefined
  try {
    const body: unknown = JSON.parse(text)
    return typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined
  } catch {
    return undefined
  }
}

/**
 * `/rpc/<method>` (OC-128): selected control-plane methods over HTTP behind the control bearer token.
 * `401` without the token, `400` for a method not exposed, `405` for a method other than
 * GET for `pending_devices` and POST for the others, otherwise `200 { ok: true, payload }` (`POST` takes `{ "id" }` for `approve_device`).
 */
export function rpcRoute(
  token: string,
  devices: DevicePairing,
): (request: Request) => Promise<Response> {
  const authorized = bearerCheck(token)
  return async (request) => {
    if (!authorized(request.headers.get('authorization') ?? undefined)) {
      return Response.json(
        { ok: false, error: { type: 'unauthorized' } },
        { status: 401, headers: { 'www-authenticate': 'Bearer' } },
      )
    }
    if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
    const method = methodOf(new URL(request.url).pathname)
    if (!METHODS.has(method)) {
      return Response.json({ ok: false, error: { type: 'invalid_request', message: `admin HTTP RPC method is not supported: ${method}` } }, { status: 400 })
    }
    // Only listing is a read; the methods that change state are POST.
    if ((method === 'pending_devices') !== (request.method === 'GET')) {
      return new Response(null, { status: 405, headers: { Allow: method === 'pending_devices' ? 'GET' : 'POST' } })
    }
    const id = request.method === 'POST' ? await readId(request) : undefined
    const answer = await handleDeviceFrame(devices, true, { type: method, id }, () => undefined)
    if (answer?.type === 'error')
      return Response.json({ ok: false, error: answer }, { status: 400 })
    return Response.json({ ok: true, payload: answer })
  }
}
