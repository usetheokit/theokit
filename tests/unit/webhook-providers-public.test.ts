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
 */
describe('server/webhook — the public surface', () => {
  it('exports every signature validator a channel webhook needs', async () => {
    const mod = await import('../../packages/theo/src/server/webhook/index.js')

    for (const provider of ['telegram', 'discord', 'slack', 'github', 'stripe']) {
      expect(typeof (mod as Record<string, unknown>)[provider]).toBe('function')
    }
  })
})
