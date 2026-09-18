import { describe, expect, it } from 'vitest'

import { createPreviewMarker } from '../../src/server/auth/preview-marker.js'
import * as authBarrel from '../../src/server/auth/index.js'

/**
 * The preview marker: who is allowed to see an unpublished document, and for how long.
 *
 * ## Why a marker and not a framework-owned draft store
 *
 * This framework has no content model, so it cannot know which document is unpublished — that is the
 * application's. What it CAN own is the credential: signed, expiring, and readable at one point that
 * runs for every response including a rendered one. `docs/surfaces/draft-preview.md` reported the
 * absence of all of it and proposed the shape; B-034 is the item that says a named surface must be
 * either built or declared absent, and this is the built answer.
 *
 * ## Built on the session machinery, not beside it
 *
 * `createSessionManagerWeb` already encrypts, rotates keys, and writes a cookie with the attributes
 * a credential needs. A second implementation of any of that would be a second thing to get wrong,
 * so the marker is a CONFIGURED INSTANCE of it under its own cookie name.
 *
 * ## The expiry is inside the payload, not only on the cookie
 *
 * A cookie's `Max-Age` is a client-side hint: it is stripped by a copy-paste into curl, and it is not
 * signed. So the signed payload carries its own `exp`, and the reader refuses a marker whose `exp`
 * has passed even when the cookie itself arrived intact. "Mandatory expiry" has to mean the half the
 * caller cannot edit.
 */

const SECRET = 'a'.repeat(32)

/** Grant a marker and hand back the `Cookie` header a browser would send next. */
async function granted(ttlSeconds: number): Promise<string> {
  const marker = createPreviewMarker({ secret: SECRET })
  const headers = new Headers()
  await marker.grant(headers, ttlSeconds)
  const setCookie = headers.get('set-cookie') ?? ''
  return setCookie.split(';')[0] ?? ''
}

function requestWith(cookie: string): Request {
  return new Request('http://localhost/draft/post-1', { headers: { cookie } })
}

describe('the preview marker decides who may see an unpublished document', () => {
  it('test_a_request_with_NO_marker_is_not_preview', async () => {
    const marker = createPreviewMarker({ secret: SECRET })
    expect(await marker.isPreview(new Request('http://localhost/draft/post-1'))).toBe(false)
  })

  it('test_a_granted_marker_IS_preview', async () => {
    // The load-bearing positive. A reader that refused everything would satisfy every other test
    // here and ship a preview nobody can enter.
    const marker = createPreviewMarker({ secret: SECRET })
    expect(await marker.isPreview(requestWith(await granted(3600)))).toBe(true)
  })

  it('test_an_EXPIRED_payload_is_refused_even_when_the_cookie_arrives', async () => {
    // `Max-Age` is a hint the caller can drop; the signed `exp` is not. This is the case that makes
    // the expiry mandatory rather than advisory.
    const marker = createPreviewMarker({ secret: SECRET })
    expect(await marker.isPreview(requestWith(await granted(-1)))).toBe(false)
  })

  it('test_a_TAMPERED_marker_is_refused', async () => {
    const cookie = await granted(3600)
    const [name, value] = cookie.split('=')
    const flipped = `${name}=${(value ?? '').slice(0, -2)}xx`
    const marker = createPreviewMarker({ secret: SECRET })
    expect(await marker.isPreview(requestWith(flipped))).toBe(false)
  })

  it('test_a_marker_minted_with_ANOTHER_secret_is_refused', async () => {
    const cookie = await granted(3600)
    const other = createPreviewMarker({ secret: 'b'.repeat(32) })
    expect(await other.isPreview(requestWith(cookie))).toBe(false)
  })

  it('test_revoke_clears_it', async () => {
    const marker = createPreviewMarker({ secret: SECRET })
    const headers = new Headers()
    marker.revoke(headers)
    expect(headers.get('set-cookie') ?? '', 'revoking wrote no cookie to clear').toContain(
      'theo_preview=',
    )
  })

  it('test_an_application_can_REACH_it_from_the_published_subpath', () => {
    // The caller half. A credential an application cannot import is a credential nobody uses, and
    // `./server/auth` is the entry the manifest publishes — the same barrel `createSessionManagerWeb`
    // arrives through, which is where a reader looking for a session-shaped thing will look.
    expect(
      typeof (authBarrel as Record<string, unknown>).createPreviewMarker,
      '`createPreviewMarker` is not on the published auth barrel',
    ).toBe('function')
  })
})
