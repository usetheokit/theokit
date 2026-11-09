/**
 * The hold-back shared by the output mask (bytes a stream writes) and the stream mask (text a
 * model streams): a value split across two pieces is held until it can be told apart (B-369,
 * B-398 FR-005).
 */
import { maskSecrets } from './channel-loop.js'

/** The length of the longest end of `text` that could still grow into one of `secrets`. */
function heldLength(text: string, secrets: readonly string[]): number {
  let held = 0
  for (const secret of secrets) {
    for (let length = Math.min(secret.length - 1, text.length); length > held; length -= 1) {
      if (text.endsWith(secret.slice(0, length))) {
        held = length
        break
      }
    }
  }
  return held
}

/**
 * Where to cut `raw` between what can be released now and what must wait for the next write: no
 * later than the start of an end that could still grow into a credential, and never inside a
 * complete one. Cutting on the raw bytes, before masking, keeps a short credential that is the
 * start of a longer one from being released while the longer one may still be arriving.
 */
function releasableLength(raw: string, secrets: readonly string[]): number {
  let cut = raw.length - heldLength(raw, secrets)
  for (let moved = true; moved; ) {
    moved = false
    for (const secret of secrets) {
      for (let at = raw.indexOf(secret); at !== -1 && at < cut; at = raw.indexOf(secret, at + 1)) {
        if (at + secret.length > cut) {
          cut = at
          moved = true
        }
      }
    }
  }
  return cut
}

export interface StreamMask {
  /** Masked, what of `pending + text` can no longer grow into a configured value. */
  push(text: string): string
  /** Masked, whatever is still held. */
  flush(): string
}

/**
 * An exact-value mask over text that arrives in pieces, such as a model's text deltas: each
 * `push` returns the masked part that is safe to release, and `flush` the rest. Concatenated,
 * the outputs equal `maskSecrets` over the whole text. A value is delivered late by at most its
 * length minus one character.
 */
export function createStreamMask(secrets: readonly string[]): StreamMask {
  const values = secrets.filter((secret) => secret.length > 0)
  let pending = ''
  return {
    push: (text) => {
      const raw = pending + text
      const cut = releasableLength(raw, values)
      pending = raw.slice(cut)
      return maskSecrets(raw.slice(0, cut), values)
    },
    flush: () => {
      const rest = pending
      pending = ''
      return maskSecrets(rest, values)
    },
  }
}
