import { describe, expect, it } from 'vitest'

import {
  deployedRateLimitFragment,
  UnserialisableRateLimitError,
} from '../../packages/theo/src/adapters/deployed-rate-limit.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

type RateLimitConfig = NonNullable<TheoConfig['rateLimit']>

/**
 * B-257 / T2.1 — EC-1 of the edge review, and it is the one MUST FIX that no escape can solve.
 *
 * A deployed entry is a GENERATED STRING. `module` and `options` reach it through `JSON.stringify`,
 * as `trustProxy` already does at `deployed-rate-limit.ts:192`. **`factory` cannot**: it becomes a
 * bare identifier in `import { <factory> } from …`, where `JSON.stringify` would emit
 * `import { "x" }`, which does not parse. So the only options are *interpolate raw* or *validate*.
 *
 * Interpolating raw makes a `theo.config.ts` — a file that usually arrives with the clone — able to
 * choose what runs inside every deployment's edge worker. It is validated, and refused by name in
 * the shape `bakeableRateLimit` already uses for a function `keyBy`.
 */

const withStore = (store: unknown): RateLimitConfig =>
  ({ windowMs: 60_000, max: 10, store }) as unknown as RateLimitConfig

describe('a baked store cannot inject code into a generated entry (B-257 EC-1)', () => {
  it('test_a_factory_that_is_not_an_identifier_is_refused_by_name', () => {
    expect(() =>
      deployedRateLimitFragment(
        withStore({ module: '@upstash/redis', factory: "Redis } from 'evil'; //" }),
        'cloudflare',
        'request.headers.get("cf-connecting-ip")',
      ),
    ).toThrow(UnserialisableRateLimitError)
  })

  it('test_the_refusal_names_the_target_and_a_way_out', () => {
    let message = ''
    try {
      deployedRateLimitFragment(
        withStore({ module: '@upstash/redis', factory: 'x; process.exit(1)' }),
        'cloudflare',
        'addr',
      )
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('cloudflare')
    expect(message.toLowerCase()).toContain('factory')
  })

  it('test_a_plain_identifier_is_accepted', () => {
    const lines = deployedRateLimitFragment(
      withStore({ module: '@upstash/redis', factory: 'Redis' }),
      'cloudflare',
      'addr',
    )
    expect(lines.join('\n')).toContain('Redis')
  })

  it('test_the_module_specifier_is_a_json_literal_not_raw_text', () => {
    // `module` CAN be escaped, and is — a specifier carrying a quote must not end the string.
    const lines = deployedRateLimitFragment(
      withStore({ module: '@scope/pkg', factory: 'Redis' }),
      'cloudflare',
      'addr',
    )
    expect(lines.join('\n')).toContain('"@scope/pkg"')
  })

  it('test_a_store_that_is_not_an_object_is_refused', () => {
    // NEGATIVE: the schema may admit it, and a string here would be interpolated somewhere.
    expect(() => deployedRateLimitFragment(withStore('redis'), 'cloudflare', 'addr')).toThrow(
      UnserialisableRateLimitError,
    )
  })
})
