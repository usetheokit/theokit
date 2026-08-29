/**
 * A dev server must be reachable through a tunnel (usetheokit/theokit#555).
 *
 * Vite rejects any request whose `Host` is not loopback and names `server.allowedHosts` as the fix.
 * A scaffolded app has no `vite.config.ts` — `theokit dev` owns the Vite server — so that fix was
 * unreachable from `theo.config.ts`, and every webhook platform delivers to a public URL. The five
 * signature validators this framework ships exist for senders that cannot reach localhost.
 *
 * `host()` is NOT the same setting and setting it does not help: it is the bind address, and the
 * request is refused by hostname rather than by interface. The two are asserted apart below so a
 * later reader does not merge them.
 */
import { describe, expect, it } from 'vitest'

import { buildDevServerOptions } from '../../packages/theo/src/cli/commands/dev.js'
import { config } from '../../packages/theo/src/index.js'
import { theoConfigSchema } from '../../packages/theo/src/config/schema.js'

describe('allowedHosts reaches the Vite dev server (#555)', () => {
  it('the schema accepts a host list', () => {
    const parsed = theoConfigSchema.parse({ allowedHosts: ['.trycloudflare.com', 'app.local'] })
    expect(parsed.allowedHosts).toEqual(['.trycloudflare.com', 'app.local'])
  })

  it('the schema accepts `true`, the escape for an unpredictable tunnel hostname', () => {
    expect(theoConfigSchema.parse({ allowedHosts: true }).allowedHosts).toBe(true)
  })

  it('the schema refuses a bare string, which Vite does not accept either', () => {
    expect(() => theoConfigSchema.parse({ allowedHosts: '.trycloudflare.com' })).toThrow()
  })

  it('the builder carries it, so an app never needs `.set()` for this', () => {
    expect(config().allowedHosts(['.trycloudflare.com']).build().allowedHosts).toEqual([
      '.trycloudflare.com',
    ])
  })

  /**
   * The load-bearing case: everything above can pass while the value never reaches Vite, which is
   * precisely the shape of the reported defect — a setting that exists and does nothing.
   */
  it('the configured value lands on the Vite server options', () => {
    const options = buildDevServerOptions({ allowedHosts: ['.trycloudflare.com'] } as never, 3000)
    expect(options.allowedHosts).toEqual(['.trycloudflare.com'])
  })

  it('an app that said nothing gets Vite’s own default, not an empty allowlist', () => {
    // `[]` would be worse than absent: it reads as a decision and blocks every host, including the
    // loopback names Vite permits out of the box.
    expect(buildDevServerOptions({} as never, 3000)).not.toHaveProperty('allowedHosts')
  })

  it('does not conflate the bind host with the allowed hostnames', () => {
    const options = buildDevServerOptions(
      { host: '0.0.0.0', allowedHosts: ['tunnel.example.com'] } as never,
      3000,
    )
    expect(options.host).toBe('0.0.0.0')
    expect(options.allowedHosts).toEqual(['tunnel.example.com'])
  })
})
