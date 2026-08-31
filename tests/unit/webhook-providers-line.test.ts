/**
 * LINE must be servable through `handleChannelWebhook` (usetheokit/theokit#590).
 *
 * `server/webhook` shipped validators for six platforms and LINE was not one of them, while
 * `@theokit/gateway-line` already published `verifyLineSignature`. Neither package was wrong on its
 * own — nothing joined them, so every app that wanted LINE wrote the bridge itself. Measured in a
 * real consumer: 19 non-comment lines, reimplementing two details that are easy to get wrong and
 * expensive to debug.
 *
 * **The body must be read RAW.** LINE signs the exact bytes, so a parsed-and-restringified body
 * hashes differently and rejects every correct request. `handleChannelWebhook` hands the validator
 * a `clone()` precisely so this is possible; an app rolling its own has to know that unprompted.
 * Same class of defect as #534 and as WhatsApp's in #556.
 *
 * **The primitive's three arguments are all strings.** `verifyLineSignature(secret, body,
 * signature)` typechecks with them in any order and fails only at runtime, as a 401 indistinguish-
 * able from a bad credential. The reporter measured exactly that against LINE's own endpoint test
 * on 2026-08-30.
 *
 * ## Why a named validator when the seam already accepts any `VerifyFn`
 *
 * `ChannelWebhookConfig.validators` is `Record<string, VerifyFn>` — it never refused a
 * hand-written LINE validator, and a custom platform still needs no permission from this module.
 * That is what makes this different from the closed provider registry of #579/#585: that list
 * REFUSED what it did not name, and this one refuses nothing. What ships here is the knowledge
 * above, paid once instead of per app — the same argument `@Public()` made in #574, where the
 * mechanism existed and the nameable half did not.
 */
import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { line } from '../../packages/theo/src/server/webhook/providers/line.js'

// Test-only fixture; no network call, no real credential.
const CHANNEL_SECRET = 'fixture-only-not-a-line-channel-secret'
const BODY = JSON.stringify({ events: [{ type: 'message', message: { text: 'oi' } }] })

/** LINE signs the raw body with HMAC-SHA256 and sends it BASE64 — not hex, and with no prefix. */
function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

const post = (body: string, headers: Record<string, string> = {}): Request =>
  new Request('https://app.test/api/channels/line', { method: 'POST', body, headers })

describe('line() validates the LINE signature (#590)', () => {
  it('accepts a correctly signed delivery', async () => {
    const verify = line({ channelSecret: CHANNEL_SECRET })

    await expect(
      verify(post(BODY, { 'x-line-signature': sign(CHANNEL_SECRET, BODY) })),
    ).resolves.toEqual({ ok: true })
  })

  it('rejects a signature computed with a different secret', async () => {
    const verify = line({ channelSecret: CHANNEL_SECRET })
    const result = await verify(post(BODY, { 'x-line-signature': sign('someone-elses', BODY) }))

    expect(result).toEqual({ ok: false, reason: 'signature mismatch' })
  })

  it('rejects a body that was altered after signing', async () => {
    // The point of signing at all. Without this, "accepts a correct signature" is satisfied by a
    // validator that ignores the body entirely.
    const verify = line({ channelSecret: CHANNEL_SECRET })
    const result = await verify(
      post('{"events":[]}', { 'x-line-signature': sign(CHANNEL_SECRET, BODY) }),
    )

    expect(result).toEqual({ ok: false, reason: 'signature mismatch' })
  })

  it('names the missing header rather than failing anonymously', async () => {
    const verify = line({ channelSecret: CHANNEL_SECRET })
    const result = await verify(post(BODY))

    expect(result).toEqual({ ok: false, reason: 'missing x-line-signature header' })
  })

  it('rejects a header that is not valid base64', async () => {
    // Distinct from a mismatch: malformed input is the caller's error, and saying which it was is
    // the difference between a 401 someone can act on and one they cannot.
    const verify = line({ channelSecret: CHANNEL_SECRET })
    const result = await verify(post(BODY, { 'x-line-signature': 'not!valid!base64!' }))

    expect(result).toEqual({ ok: false, reason: 'malformed signature base64' })
  })

  it('accepts either secret during a rotation', async () => {
    // Same contract the hub-signature validators give: an overlap window is what makes rotating a
    // secret survivable instead of an outage.
    const verify = line({ channelSecret: ['old-secret', 'new-secret'] })

    await expect(
      verify(post(BODY, { 'x-line-signature': sign('old-secret', BODY) })),
    ).resolves.toEqual({ ok: true })
    await expect(
      verify(post(BODY, { 'x-line-signature': sign('new-secret', BODY) })),
    ).resolves.toEqual({ ok: true })
  })

  it('does NOT accept a hex signature — LINE sends base64', async () => {
    // The concrete trap this closes. A reader who copies the GitHub or WhatsApp validator sends hex
    // and gets a 401 that looks exactly like a wrong channel secret.
    const verify = line({ channelSecret: CHANNEL_SECRET })
    // CHANNEL_SECRET is the module fixture declared above, not a credential: the rule matches
    // `createHmac(alg, <identifier>)` and cannot tell a test constant from a real one. Every other
    // call in this file goes through the `sign()` helper, which is why only this line trips it.
    // eslint-disable-next-line sonarjs/hardcoded-secret-signatures -- module fixture, not a secret
    const hex = createHmac('sha256', CHANNEL_SECRET).update(BODY).digest('hex')
    const result = await verify(post(BODY, { 'x-line-signature': hex }))

    expect(result.ok).toBe(false)
  })

  it('leaves the request body readable by the handler', async () => {
    // `handleChannelWebhook` passes a clone, but a validator that consumed the original would break
    // every handler downstream. Asserting it here keeps the contract local to the validator.
    const verify = line({ channelSecret: CHANNEL_SECRET })
    const req = post(BODY, { 'x-line-signature': sign(CHANNEL_SECRET, BODY) })

    await verify(req.clone())

    expect(await req.text()).toBe(BODY)
  })
})
