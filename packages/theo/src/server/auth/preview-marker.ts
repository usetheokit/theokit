/**
 * The preview credential: who may see an unpublished document, and until when (B-034).
 *
 * ## What this owns, and what it deliberately does not
 *
 * This framework has no content model, so it cannot know which document is unpublished — that is the
 * application's to decide. What a framework can own is the CREDENTIAL: signed, expiring, and
 * readable at a point that runs for every response including a rendered one.
 *
 * `docs/surfaces/draft-preview.md` measured the absence of all of it on 2026-08-20 — `noindex`,
 * `robots`, `isPreview`, `draftMode` and `previewMode` returned zero hits across both source trees —
 * and proposed the shape. B-034 is the item saying a named surface must be either built or declared
 * absent. This is the built answer.
 *
 * ## A configured instance of the session machinery, not a second one
 *
 * `createSessionManagerWeb` already encrypts with key rotation and writes a cookie with the
 * attributes a credential needs (`httpOnly`, `sameSite`, `secure` in production). A second
 * implementation of any of that is a second thing to get wrong, so the marker is that manager under
 * its own cookie name and nothing more.
 *
 * ## The expiry lives in the payload, not only on the cookie
 *
 * `Max-Age` is a client-side hint: a caller who copies the cookie into curl drops it, and nothing
 * signs it. So the encrypted payload carries its own `exp` and the reader refuses a marker whose
 * `exp` has passed even when the cookie arrived intact. "Mandatory expiry" has to mean the half the
 * caller cannot edit — the cookie attribute is the courtesy, the payload is the control.
 */
import { createSessionManagerWeb } from './session.js'

/** What a preview marker carries. Deliberately nothing else: it says WHEN, never WHO or WHAT. */
interface PreviewPayload {
  /** Epoch millis after which this marker is refused, whatever the cookie says. */
  readonly exp: number
}

export interface PreviewMarkerConfig {
  /** Same shape the session takes — a string, or an array whose index 0 is newest. */
  readonly secret: string | string[]
  /** Defaults to `theo_preview`; distinct from the session cookie so revoking one leaves the other. */
  readonly cookieName?: string
}

export interface PreviewMarker {
  /** Write a marker good for `ttlSeconds`. The cookie and the signed payload expire together. */
  grant(target: Headers, ttlSeconds: number): Promise<void>
  /** Clear the marker. Safe to call when none is present. */
  revoke(target: Headers): void
  /** Is this request carrying a marker that is intact, ours, and unexpired? */
  isPreview(request: Request): Promise<boolean>
}

const DEFAULT_COOKIE = 'theo_preview'

export function createPreviewMarker(config: PreviewMarkerConfig): PreviewMarker {
  const cookieName = config.cookieName ?? DEFAULT_COOKIE

  // One manager per TTL so the cookie's `Max-Age` and the payload's `exp` agree. Building it is
  // closures over the secrets — no I/O, no key derivation — so the alternative (one manager with a
  // fixed maxAge, and a payload that may outlive its own cookie) buys nothing and reads worse.
  const managerFor = (maxAge: number): ReturnType<typeof createSessionManagerWeb<PreviewPayload>> =>
    createSessionManagerWeb<PreviewPayload>({ secret: config.secret, cookieName, maxAge })

  return {
    async grant(target, ttlSeconds) {
      // A non-positive TTL is granted rather than refused: it writes a marker already expired, which
      // is what a caller asking for one deserves, and it keeps `grant` total so a test can build the
      // expired case without reaching past the API.
      await managerFor(Math.max(ttlSeconds, 0)).createSession(target, {
        exp: Date.now() + ttlSeconds * 1000,
      })
    },

    revoke(target) {
      managerFor(0).destroySession(target)
    },

    async isPreview(request) {
      // Tampered, foreign-secret and absent all arrive here as `null` — the session manager already
      // treats a decrypt it cannot complete as no session, and there is nothing this layer could add
      // to that distinction that a caller should act on differently.
      const payload = await managerFor(0).getSession(request)
      if (payload === null) return false
      return typeof payload.exp === 'number' && payload.exp > Date.now()
    },
  }
}
