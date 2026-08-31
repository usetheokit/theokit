import { describe, expect, it } from 'vitest'

/**
 * The signature validators `handleChannelWebhook` requires must be reachable from the published
 * package.
 *
 * Measured against `theokit@0.48.14`: `handleChannelWebhook(request, path, { validators, onMessage })`
 * takes a `validators` map and its own docblock demonstrates `{ slack: slack({...}), telegram:
 * telegram({...}) }` — while `packages/theo/src/server/webhook/index.ts` re-exported none of the six
 * providers that exist beside it. The published bundle carried no `providers/` file at all, and the
 * string `x-telegram-bot-api-secret-token` appeared nowhere in `dist/`. The framework's own test
 * imports them by relative source path, which is why nothing noticed.
 *
 * The consequence is that the channel-webhook seam could not be wired by a consumer of the package:
 * the parameter is required, and no value for it shipped. Found while writing the `theokit-gateways`
 * scaffold skill, trying to show the wiring (theokit-gateways B-011).
 *
 * ## Why this derives the list instead of naming it
 *
 * The first version listed the six providers by hand. That guard only ever knew what somebody had
 * already remembered to add: when `line` arrived (#590), the barrel could have missed it and this
 * test would still have passed, reporting a surface it had not checked. A hand-kept list of what to
 * verify is the same defect as the surface it verifies, one level up.
 *
 * Asking `providers/index.js` what exists makes a new provider covered the moment it is written,
 * and makes forgetting the barrel a failure rather than a silence. Same correction as #542, where a
 * guard over documented imports stopped consulting a list of known-bad names and started asking the
 * package.
 */
describe('server/webhook — the public surface', () => {
  it('re-exports every provider that exists beside it', async () => {
    const providers = await import('../../packages/theo/src/server/webhook/providers/index.js')
    const barrel = await import('../../packages/theo/src/server/webhook/index.js')

    const factories = Object.entries(providers as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)

    // The positive half. Without it, a `providers/index.js` that exported nothing would satisfy
    // the loop below and this file would assert that an empty surface is complete.
    expect(factories.length).toBeGreaterThanOrEqual(7)
    expect(factories).toContain('line')

    const missing = factories.filter(
      (name) => typeof (barrel as Record<string, unknown>)[name] !== 'function',
    )

    expect(missing, 'a provider that exists but is unreachable from the package').toEqual([])
  })

  it('exports the subscribe handshake a Meta platform needs before it delivers anything', async () => {
    // A validator alone does not make WhatsApp servable: Meta verifies the endpoint with a GET
    // first, and refusing that leaves the webhook unsubscribed (#556).
    const mod = await import('../../packages/theo/src/server/webhook/index.js')

    expect(typeof (mod as Record<string, unknown>).whatsappSubscribe).toBe('function')
  })
})
