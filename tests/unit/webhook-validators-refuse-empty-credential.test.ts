/**
 * A validator built with no usable credential REFUSES; it does not throw, and it never accepts
 * (usetheokit/theokit#594).
 *
 * ## What was measured
 *
 * `line({ channelSecret: '' })` raised `DataError: Zero-length key is not supported` from inside
 * WebCrypto's `importKey`. `node:crypto`'s legacy `createHmac` tolerates a zero-length key and
 * WebCrypto does not, and WebCrypto is the path every validator here takes (ADR-0028, so the same
 * code runs on Workers, Bun and Deno).
 *
 * The case is not exotic. `line({ channelSecret: process.env.LINE_CHANNEL_SECRET ?? '' })` is the
 * natural call site, so it is what one unset environment variable produces. The operator gets a
 * crypto error naming neither the variable nor the platform, and `handleChannelWebhook` does not
 * catch it — the throw escapes the seam as a 500, past the 401 path that exists to say why a
 * delivery was refused.
 *
 * The same lens over the other validators found three further shapes, and only the first was in
 * the report:
 *
 *   1. **Throws** on an empty secret: `line`, `github`, `whatsapp`, `slack`, `stripe`.
 *   2. **Answers `signature mismatch`** on an EMPTY LIST (`line({ channelSecret: [] })`), which
 *      says the signature was checked and did not match. Nothing was checked: the per-secret loop
 *      had nothing to iterate. A wrong answer is worse than an error, because it sends the reader
 *      to look at the sender's signature instead of at their own configuration.
 *   3. **Accepts.** `whatsappSubscribe({ verifyToken: '' })` returned `{ ok: true }` for a request
 *      presenting `hub.verify_token=` — `timingSafeEqual` is documented to return true for two
 *      zero-length inputs, correctly, and the caller has to reject the empty case before asking.
 *      That one IS an authentication bypass and is filed separately.
 *
 * ## Why refusing, rather than throwing at construction
 *
 * `VerifyResult` already carries a `reason` for precisely this answer, and `VerifyFn`'s contract is
 * that it returns ok/not-ok — a validator that throws breaks the contract its own callers were
 * written against. Refusing also fails closed: the delivery is rejected, `handleChannelWebhook`
 * renders `401 INVALID_SIGNATURE: <reason>`, and the reason names the misconfigured option instead
 * of blaming the sender.
 *
 * ## Why an empty entry in a LIST refuses everything
 *
 * `['current', '']` is what a half-finished rotation looks like: one variable set, the other not.
 * Filtering the empty one out would verify deliveries with the secret that IS set and say nothing,
 * so the misconfiguration surfaces on the day the remaining secret is retired — in production, at
 * 100% of traffic. Refusing surfaces it on the first delivery, when it costs a line of config.
 */
import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  discord,
  github,
  line,
  slack,
  stripe,
  telegram,
  whatsapp,
  whatsappSubscribe,
} from '../../packages/theo/src/server/webhook/providers/index.js'

const BODY = JSON.stringify({ events: [] })

const post = (headers: Record<string, string>): Request =>
  new Request('https://app.test/api/agents/a/channels/p/webhook', {
    method: 'POST',
    body: BODY,
    headers,
  })

const now = (): number => Math.floor(Date.now() / 1000)

/** Sign `body` the way these platforms do. The key is a parameter — every caller below is a fixture. */
const sign = (key: string, body: string, encoding: 'base64' | 'hex'): string =>
  createHmac('sha256', key).update(body).digest(encoding)

/**
 * Any key at all: these headers exist so the refusal cannot be attributed to a malformed value, and
 * what signed them is irrelevant — no validator under test has a credential to compare against.
 */
const ARBITRARY_KEY = 'signed-with-anything'

/** A syntactically valid header value, so the refusal cannot be attributed to a malformed one. */
const HEADERS = {
  line: { 'x-line-signature': sign(ARBITRARY_KEY, BODY, 'base64') },
  hub: { 'x-hub-signature-256': `sha256=${sign(ARBITRARY_KEY, BODY, 'hex')}` },
  telegram: { 'x-telegram-bot-api-secret-token': 'presented-by-the-caller' },
  discord: { 'x-signature-ed25519': 'ab'.repeat(64), 'x-signature-timestamp': '1' },
}

const slackHeaders = (): Record<string, string> => ({
  'x-slack-request-timestamp': String(now()),
  'x-slack-signature': `v0=${'ab'.repeat(32)}`,
})

const stripeHeaders = (): Record<string, string> => ({
  'stripe-signature': `t=${now()},v1=${'ab'.repeat(32)}`,
})

/**
 * Every (validator, unusable credential) pair, with the request that reaches its crypto.
 *
 * A table rather than eight near-identical blocks: the assertion is the same for all of them, and
 * the thing worth reading is which configurations count as unusable.
 */
const UNUSABLE: ReadonlyArray<{
  name: string
  build: () => (
    req: Request,
  ) => Promise<{ ok: boolean; reason?: string }> | { ok: boolean; reason?: string }
  request: () => Request
  reason: string
}> = [
  {
    name: "line({ channelSecret: '' })",
    build: () => line({ channelSecret: '' }),
    request: () => post(HEADERS.line),
    reason: 'channelSecret is empty',
  },
  {
    name: 'line({ channelSecret: [] })',
    build: () => line({ channelSecret: [] }),
    request: () => post(HEADERS.line),
    reason: 'no channelSecret configured',
  },
  {
    name: "line({ channelSecret: ['set', ''] })",
    build: () => line({ channelSecret: ['a-configured-secret', ''] }),
    request: () => post(HEADERS.line),
    reason: 'channelSecret[1] is empty',
  },
  {
    name: "github({ secret: '' })",
    build: () => github({ secret: '' }),
    request: () => post(HEADERS.hub),
    reason: 'secret is empty',
  },
  {
    name: 'github({ secret: [] })',
    build: () => github({ secret: [] }),
    request: () => post(HEADERS.hub),
    reason: 'no secret configured',
  },
  {
    name: "whatsapp({ appSecret: '' })",
    build: () => whatsapp({ appSecret: '' }),
    request: () => post(HEADERS.hub),
    reason: 'appSecret is empty',
  },
  {
    name: 'whatsapp({ appSecret: [] })',
    build: () => whatsapp({ appSecret: [] }),
    request: () => post(HEADERS.hub),
    reason: 'no appSecret configured',
  },
  {
    name: "slack({ signingSecret: '' })",
    build: () => slack({ signingSecret: '' }),
    request: () => post(slackHeaders()),
    reason: 'signingSecret is empty',
  },
  {
    name: "stripe({ secret: '' })",
    build: () => stripe({ secret: '' }),
    request: () => post(stripeHeaders()),
    reason: 'secret is empty',
  },
  {
    name: 'stripe({ secret: [] })',
    build: () => stripe({ secret: [] }),
    request: () => post(stripeHeaders()),
    reason: 'no secret configured',
  },
  {
    name: "telegram({ secretToken: '' })",
    build: () => telegram({ secretToken: '' }),
    request: () => post(HEADERS.telegram),
    reason: 'secretToken is empty',
  },
  {
    name: "discord({ publicKey: '' })",
    build: () => discord({ publicKey: '' }),
    request: () => post(HEADERS.discord),
    reason: 'publicKey is empty',
  },
]

describe('a validator with no usable secret refuses (#594)', () => {
  for (const { name, build, request, reason } of UNUSABLE) {
    it(`${name} refuses with a reason naming the option`, async () => {
      // `await` on the call rather than `.resolves` on it: `VerifyFn` is sync-or-async by
      // contract and `telegram` is the synchronous one. Either way a throw propagates here and
      // fails the test, which is the reported defect — the crypto error escaped as an exception
      // where the seam expected a result.
      expect(await build()(request())).toEqual({ ok: false, reason })
    })
  }

  it('names the configuration, never the sender', async () => {
    // The load-bearing half of the refusal. `signature mismatch` is a true statement about a
    // delivery signed with the wrong secret and a false one here: nothing was compared. An operator
    // reading it goes to look at the platform console instead of at their own environment.
    for (const { build, request } of UNUSABLE) {
      const result = (await build()(request())) as { ok: boolean; reason: string }

      expect(result.ok).toBe(false)
      expect(result.reason).not.toContain('mismatch')
    }
  })
})

describe('whatsappSubscribe refuses an empty verifyToken (#594)', () => {
  const handshake = (token: string): Request =>
    new Request(
      `https://app.test/api/agents/a/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1234`,
    )

  it('does not accept a caller presenting an empty token', async () => {
    // Measured before the fix: `{ ok: true, challenge: '1234' }`. An app whose META verify token is
    // unset would let any caller complete the subscription handshake — the one thing the token
    // exists to prevent.
    expect(await whatsappSubscribe({ verifyToken: '' })(handshake(''))).toEqual({
      ok: false,
      reason: 'verifyToken is empty',
    })
  })

  it('refuses regardless of what the caller presents', async () => {
    const verify = whatsappSubscribe({ verifyToken: '' })

    expect(await verify(handshake('anything'))).toEqual({
      ok: false,
      reason: 'verifyToken is empty',
    })
  })
})

describe('a configured validator is unaffected (#594)', () => {
  const CONFIGURED = 'fixture-only-not-a-real-credential'

  it('line still accepts a correctly signed delivery', async () => {
    const verify = line({ channelSecret: CONFIGURED })
    const signature = sign(CONFIGURED, BODY, 'base64')

    await expect(verify(post({ 'x-line-signature': signature }))).resolves.toEqual({ ok: true })
  })

  it('line still verifies every secret of a fully configured rotation', async () => {
    const verify = line({ channelSecret: [CONFIGURED, 'the-incoming-one'] })
    const signature = sign('the-incoming-one', BODY, 'base64')

    await expect(verify(post({ 'x-line-signature': signature }))).resolves.toEqual({ ok: true })
  })

  it('whatsappSubscribe still completes a handshake with the configured token', async () => {
    const verify = whatsappSubscribe({ verifyToken: CONFIGURED })
    const req = new Request(
      `https://app.test/w?hub.mode=subscribe&hub.verify_token=${CONFIGURED}&hub.challenge=1234`,
    )

    expect(await verify(req)).toEqual({ ok: true, challenge: '1234' })
  })
})
