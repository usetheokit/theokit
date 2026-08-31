/**
 * What counts as a USABLE credential, decided once for every validator in this directory (#594).
 *
 * The defect this exists to close: `line({ channelSecret: '' })` reached WebCrypto's `importKey`
 * and raised `DataError: Zero-length key is not supported`. `node:crypto`'s legacy `createHmac`
 * tolerates a zero-length key; WebCrypto does not, and WebCrypto is the path all of these take
 * (ADR-0028, so the same code runs on Workers, Bun and Deno). The throw escapes
 * `handleChannelWebhook` as a 500, past the 401 branch that exists to say why a delivery was
 * refused.
 *
 * It lives beside `hmac-sha256.ts` and for the same stated reason: this is not a shape, it is a
 * security decision — which configurations may verify a delivery at all — and the second copy is
 * the one that drifts. Six validators reached the same wrong answer independently, which is the
 * measurement that argues for one implementation rather than six guards.
 *
 * ## The three answers, and why they are three
 *
 * | Configuration | Answer | Why not something else |
 * |---|---|---|
 * | `''` | `<option> is empty` | The reported case: one unset environment variable |
 * | `[]` | `no <option> configured` | Distinct from the above — a list nobody filled, not a value nobody set |
 * | `['set', '']` | `<option>[1] is empty` | A half-finished rotation; the index says WHICH one |
 *
 * An empty entry in a list refuses the whole validator rather than being filtered out. Filtering
 * would verify deliveries with the secret that IS set and stay silent, so the misconfiguration
 * surfaces on the day the remaining secret is retired — in production, against all traffic. This
 * way it surfaces on the first delivery, when it costs a line of configuration.
 *
 * Whitespace is deliberately NOT trimmed. A secret of `' '` is almost certainly a mistake, but
 * trimming would silently change the bytes a caller asked to verify against, and guessing at the
 * caller's intent is what this module exists to stop.
 */
import type { VerifyFn } from '../webhook-types.js'

/** Usable secrets, or the reason the configuration cannot verify anything. */
export type ConfiguredSecrets =
  | { ok: true; secrets: readonly string[] }
  | { ok: false; reason: string }

/**
 * Normalize `value` to a secret list and refuse the configurations that cannot verify a delivery.
 *
 * @param value  The option as the caller passed it — one secret, or a rotation list.
 * @param option The option's name (`channelSecret`, `appSecret`, …). It goes into the reason, so
 *               the refusal names the thing the operator has to set rather than the sender.
 */
export function configuredSecrets(
  value: string | readonly string[],
  option: string,
): ConfiguredSecrets {
  const secrets = typeof value === 'string' ? [value] : value

  if (secrets.length === 0) return { ok: false, reason: `no ${option} configured` }

  for (let i = 0; i < secrets.length; i++) {
    if (secrets[i].length === 0) {
      // A single value has no meaningful index, and `channelSecret[0] is empty` would send a
      // reader looking for an array they never wrote.
      const where = typeof value === 'string' ? option : `${option}[${i}]`
      return { ok: false, reason: `${where} is empty` }
    }
  }

  return { ok: true, secrets }
}

/**
 * A {@link VerifyFn} that refuses every request with `reason`.
 *
 * Returning this from a factory keeps the refusal on the contract callers were written against:
 * `VerifyFn` answers ok/not-ok, `VerifyResult` already carries a `reason` for exactly this answer,
 * and `handleChannelWebhook` renders it as `401 INVALID_SIGNATURE: <reason>`. Throwing at
 * construction would be louder and would break that contract — and it would take down a process
 * for a platform the app may never receive a delivery on.
 *
 * It fails closed: nothing is accepted while the credential is missing.
 */
export function refusingVerifier(reason: string): VerifyFn {
  return () => ({ ok: false, reason })
}
