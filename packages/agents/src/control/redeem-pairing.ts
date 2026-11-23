import { randomBytes } from 'node:crypto'

import { TheokitAgentError } from '@theokit/sdk/errors'

/** The gateway refused a setup code. `status` is the HTTP status; the message never contains the credential. */
export class PairingRefusedError extends TheokitAgentError {
  override readonly name = 'PairingRefusedError'
  constructor(
    message: string,
    readonly status: number,
    /** The route's `error` reason (`unknown_or_expired`, `bad_name`, ...), when it sent one. */
    readonly reason?: string,
  ) {
    super(message, { code: 'PAIRING_REFUSED', isRetryable: false })
  }
}

export interface RedeemPairingOptions {
  /** The instance: an `http(s)://` or `ws(s)://` address. Only its origin is used. */
  url: string
  /** The setup code the owner issued. */
  code: string
  /** The device name the owner sees. */
  name: string
  /** For tests and proxies; defaults to the global `fetch`. */
  fetch?: typeof fetch
}

export interface RedeemedPairing {
  /** The `ws(s)://` control address to hand to `createControlClient`. */
  url: string
  /** The credential the device chose; send it as `Bearer <credential>` once the owner approves. */
  credential: string
}

/**
 * Redeems a setup code at `/control/pair` with a credential generated here. The device is pending
 * until the owner approves it; a refused or expired code throws `PairingRefusedError`.
 */
export async function redeemPairing(options: RedeemPairingOptions): Promise<RedeemedPairing> {
  let base: URL
  try {
    base = new URL(options.url)
  } catch {
    throw new PairingRefusedError('the address is not a URL', 0)
  }
  const secure = base.protocol === 'https:' || base.protocol === 'wss:'
  if (!secure && base.protocol !== 'http:' && base.protocol !== 'ws:') {
    throw new PairingRefusedError('the address must start with http(s):// or ws(s)://', 0)
  }
  const credential = randomBytes(32).toString('hex')
  const pairUrl = new URL('/control/pair', base)
  pairUrl.protocol = secure ? 'https:' : 'http:'
  const response = await (options.fetch ?? fetch)(pairUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: options.code, name: options.name, token: credential }),
  })
  if (response.status !== 202) {
    let reason: string | undefined
    try {
      const body: unknown = await response.json()
      const error = (body as { error?: unknown } | null)?.error
      if (typeof error === 'string') reason = error
    } catch {
      // no JSON body: the status alone describes the refusal
    }
    const detail = reason === undefined ? '' : ` (${reason})`
    throw new PairingRefusedError(
      `the instance at ${pairUrl.origin} refused the pairing: HTTP ${String(response.status)}${detail}`,
      response.status,
      reason,
    )
  }
  const socket = new URL('/control', base)
  socket.protocol = secure ? 'wss:' : 'ws:'
  return { url: socket.toString(), credential }
}
