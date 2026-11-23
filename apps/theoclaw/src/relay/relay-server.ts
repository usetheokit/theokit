import { createHttpMailboxHandler } from '@theokit/sdk/a2a'

/**
 * B-694 (OC-14) — the relay: the SDK's bearer-guarded store-and-forward HTTP mailbox, mounted at
 * `/relay`. `POST /relay/put` takes a sealed message; `POST /relay/take` hands over and clears
 * what waits for a public key. It holds ciphertext only. The bearer token (shared by the
 * instances that use this relay) keeps strangers out; a holder of it can drain a mailbox, which
 * costs availability, never confidentiality. Optionally persisted so a restart keeps the queue.
 */

export const RELAY_PUT_PATH = '/relay/put'
export const RELAY_TAKE_PATH = '/relay/take'

/** The limits the relay always had, held here so an SDK default change cannot loosen them. */
export const RELAY_MAX_PER_RECIPIENT = 100
export const RELAY_MAX_BODY_BYTES = 256 * 1024

export function isRelayPath(pathname: string): boolean {
  return pathname === RELAY_PUT_PATH || pathname === RELAY_TAKE_PATH
}

export function relayRoute(
  token: string,
  options: { readonly maxPerRecipient?: number; readonly persistPath?: string } = {},
): (request: Request) => Promise<Response> {
  return createHttpMailboxHandler({
    token,
    maxPerRecipient: RELAY_MAX_PER_RECIPIENT,
    maxBodyBytes: RELAY_MAX_BODY_BYTES,
    ...options,
  })
}
